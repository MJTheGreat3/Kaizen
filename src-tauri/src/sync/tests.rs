use std::sync::Mutex;

use rusqlite::params;
use zeroize::Zeroizing;

use super::mailbox::FolderMailbox;
use super::*;
use crate::db::{DB_FILE, Database};

struct Device {
    _dir: tempfile::TempDir,
    session: Mutex<Option<Session>>,
}

impl Device {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let key = Zeroizing::new([5u8; 32]);
        let db = Database::open(&dir.path().join(DB_FILE), &key, None).unwrap();
        Self {
            _dir: dir,
            session: Mutex::new(Some(Session {
                db,
                key,
                private_until: std::sync::atomic::AtomicI64::new(0),
            })),
        }
    }

    fn conn<T>(&self, f: impl FnOnce(&Connection) -> T) -> T {
        let guard = self.session.lock().unwrap();
        f(guard.as_ref().unwrap().db.conn())
    }

    fn exec(&self, sql: &str, args: impl rusqlite::Params) {
        self.conn(|c| c.execute(sql, args).unwrap());
    }

    fn id(&self) -> String {
        self.conn(|c| engine::device_id(c).unwrap())
    }

    fn add_task(&self, id: &str, title: &str) {
        let now = chrono::Utc::now().timestamp_millis();
        self.exec(
            "INSERT INTO tasks (id, list, title, created_at, updated_at, device_id) VALUES (?1, 'todo', ?2, ?3, ?3, ?4)",
            params![id, title, now, self.id()],
        );
    }

    fn task(&self, id: &str) -> (String, Option<String>, Option<i64>) {
        self.conn(|c| {
            c.query_row(
                "SELECT title, notes, deleted_at FROM tasks WHERE id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap()
        })
    }

    fn count(&self, sql: &str) -> i64 {
        self.conn(|c| c.query_row(sql, [], |r| r.get(0)).unwrap())
    }

    fn sync(&self, mailbox: &FolderMailbox) -> Report {
        sync_mailbox(&self.session, mailbox).unwrap()
    }
}

fn paired() -> (Device, Device, FolderMailbox, tempfile::TempDir) {
    let (a, b) = (Device::new(), Device::new());
    let code = a.conn(|c| create_group(c, &[]).unwrap());
    b.conn(|c| join_group(c, &code).unwrap());
    let dir = tempfile::tempdir().unwrap();
    let mailbox = FolderMailbox {
        root: dir.path().to_path_buf(),
    };
    (a, b, mailbox, dir)
}

fn sync_all(a: &Device, b: &Device, mailbox: &FolderMailbox) {
    a.sync(mailbox);
    b.sync(mailbox);
    a.sync(mailbox);
}

#[test]
fn merges_data_entered_before_and_after_pairing() {
    let (a, b, mailbox, _dir) = paired();
    a.add_task("t-a", "From laptop");
    b.add_task("t-b", "From phone");
    sync_all(&a, &b, &mailbox);
    assert_eq!(b.task("t-a").0, "From laptop");
    assert_eq!(a.task("t-b").0, "From phone");

    // Nothing new: nothing sent, and the same bundles are not applied twice.
    let again = a.sync(&mailbox);
    assert_eq!((again.sent, again.received), (0, 0));

    // Soft deletes travel like any other change.
    a.exec("UPDATE tasks SET deleted_at = 42 WHERE id = 't-b'", []);
    sync_all(&a, &b, &mailbox);
    assert_eq!(b.task("t-b").2, Some(42));
}

#[test]
fn keeps_both_sides_of_edits_to_different_fields() {
    let (a, b, mailbox, _dir) = paired();
    a.add_task("t", "Draft");
    sync_all(&a, &b, &mailbox);

    a.exec("UPDATE tasks SET title = 'Final' WHERE id = 't'", []);
    std::thread::sleep(std::time::Duration::from_millis(5));
    b.exec(
        "UPDATE tasks SET notes = 'from phone', title = 'Phone title' WHERE id = 't'",
        [],
    );
    sync_all(&a, &b, &mailbox);

    // Notes only changed on B; the title changed on both and B's is later.
    assert_eq!(
        a.task("t"),
        ("Phone title".into(), Some("from phone".into()), None)
    );
    assert_eq!(b.task("t"), a.task("t"));
}

#[test]
fn local_edit_beats_a_remote_value_from_a_clock_ahead() {
    let (a, b, mailbox, _dir) = paired();
    a.add_task("t", "Original");
    sync_all(&a, &b, &mailbox);

    // B's clock is an hour ahead.
    b.exec("UPDATE tasks SET title = 'Ahead' WHERE id = 't'", []);
    b.exec(
        "UPDATE sync_clock SET ts = ts + 3600000 WHERE table_name = 'tasks' AND row_id = 't' AND col = 'title'",
        [],
    );
    sync_all(&a, &b, &mailbox);
    assert_eq!(a.task("t").0, "Ahead");

    // A edits afterwards with its slower clock and still wins everywhere.
    a.exec("UPDATE tasks SET title = 'Later on A' WHERE id = 't'", []);
    sync_all(&a, &b, &mailbox);
    assert_eq!(b.task("t").0, "Later on A");
}

#[test]
fn merges_rows_with_the_same_natural_key() {
    let (a, b, mailbox, _dir) = paired();
    let now = chrono::Utc::now().timestamp_millis();
    a.exec(
        "INSERT INTO habits (id, name, color, start_date, created_at, updated_at, device_id) VALUES ('h', 'Read', '#fff', '2026-10-01', ?1, ?1, ?2)",
        params![now, a.id()],
    );
    sync_all(&a, &b, &mailbox);

    // Both log the same habit day offline, under different ids.
    for (device, id, value) in [(&a, "log-a", 1.0), (&b, "log-b", 3.0)] {
        device.exec(
            "INSERT INTO habit_logs (id, habit_id, date, value, created_at, updated_at, device_id) VALUES (?1, 'h', '2026-10-13', ?2, ?3, ?3, ?4)",
            params![id, value, chrono::Utc::now().timestamp_millis(), device.id()],
        );
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    sync_all(&a, &b, &mailbox);

    for device in [&a, &b] {
        assert_eq!(device.count("SELECT count(*) FROM habit_logs"), 1);
        assert_eq!(
            device.count("SELECT CAST(value AS INTEGER) FROM habit_logs"),
            3
        );
    }
}

#[test]
fn waits_for_missing_bundles() {
    let (a, b, mailbox, dir) = paired();
    a.add_task("t1", "One");
    a.sync(&mailbox);
    a.add_task("t2", "Two");
    a.sync(&mailbox);

    // The first bundle has not arrived yet (e.g. still uploading).
    let group = a.conn(|c| bundle::group_id(&group_key(c).unwrap().unwrap()));
    let folder = dir.path().join(&group).join(a.id());
    let mut files: Vec<_> = std::fs::read_dir(&folder)
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect();
    files.sort();
    let held = std::env::temp_dir().join(format!("held-{}", a.id()));
    std::fs::rename(&files[0], &held).unwrap();

    let report = b.sync(&mailbox);
    assert!(report.waiting);
    assert_eq!(b.count("SELECT count(*) FROM tasks"), 0);

    std::fs::rename(&held, &files[0]).unwrap();
    let report = b.sync(&mailbox);
    assert!(!report.waiting);
    assert_eq!(b.count("SELECT count(*) FROM tasks"), 2);
}

#[test]
fn ignores_devices_in_other_groups() {
    let (a, _b, mailbox, _dir) = paired();
    let stranger = Device::new();
    stranger.conn(|c| create_group(c, &[]).unwrap());
    stranger.add_task("secret", "Not yours");
    stranger.sync(&mailbox);
    a.sync(&mailbox);
    assert_eq!(a.count("SELECT count(*) FROM tasks"), 0);
}

#[test]
fn syncs_phone_and_laptop_over_http() {
    let (laptop, phone, _unused, _dir) = paired();
    let store = tempfile::tempdir().unwrap();
    let key = laptop.conn(|c| group_key(c).unwrap().unwrap());
    let (group, token) = (bundle::group_id(&key), lan::auth_token(&key));

    let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
    let port = server.server_addr().to_ip().unwrap().port();
    let root = store.path().to_path_buf();
    std::thread::spawn(move || {
        lan::serve_on(server, root, move || Some((group.clone(), token.clone())))
    });

    let local = lan::LocalStore(FolderMailbox {
        root: store.path().to_path_buf(),
    });
    let remote = lan::HttpMailbox::new(&format!("127.0.0.1:{port}"), &key);
    assert!(remote.reachable());

    laptop.add_task("from-laptop", "Laptop task");
    phone.add_task("from-phone", "Phone task");
    sync_mailbox(&laptop.session, &local).unwrap();
    sync_mailbox(&phone.session, &remote).unwrap();
    sync_mailbox(&laptop.session, &local).unwrap();
    assert_eq!(phone.task("from-laptop").0, "Laptop task");
    assert_eq!(laptop.task("from-phone").0, "Phone task");

    // A device from another group is turned away.
    let stranger = Device::new();
    stranger.conn(|c| create_group(c, &[]).unwrap());
    let other_key = stranger.conn(|c| group_key(c).unwrap().unwrap());
    let wrong = lan::HttpMailbox::new(&format!("127.0.0.1:{port}"), &other_key);
    assert!(sync_mailbox(&stranger.session, &wrong).is_err());
    assert!(!lan::HttpMailbox::new("127.0.0.1:1", &key).reachable());
}

#[test]
fn compacts_old_bundles_and_late_devices_still_catch_up() {
    let (a, b, mailbox, dir) = paired();
    for i in 0..(COMPACT_AFTER + 3) {
        a.add_task(&format!("t{i}"), &format!("Task {i}"));
        a.exec("UPDATE tasks SET notes = 'edited' WHERE id = 't0'", []);
        a.sync(&mailbox);
    }
    let group = a.conn(|c| bundle::group_id(&group_key(c).unwrap().unwrap()));
    let files = std::fs::read_dir(dir.path().join(&group).join(a.id()))
        .unwrap()
        .count();
    assert!(files < COMPACT_AFTER, "{files} files left");

    // B pairs only now and still gets everything, including later edits.
    b.sync(&mailbox);
    assert_eq!(
        b.count("SELECT count(*) FROM tasks"),
        (COMPACT_AFTER + 3) as i64
    );
    assert_eq!(b.task("t0").1.as_deref(), Some("edited"));
}

#[test]
fn phone_learns_laptop_addresses_from_pairing_and_sync() {
    let (laptop, phone) = (Device::new(), Device::new());
    let code = laptop.conn(|c| {
        register_device(c, "macos", &["192.168.1.20".into()]).unwrap();
        create_group(c, &["192.168.1.20".into()]).unwrap()
    });
    phone.conn(|c| {
        register_device(c, "android", &[]).unwrap();
        join_group(c, &code).unwrap();
    });
    assert_eq!(
        phone.conn(|c| lan_candidates(c).unwrap()),
        vec!["192.168.1.20"]
    );

    // The laptop moves to another network (and Tailscale); the phone hears via sync.
    laptop.conn(|c| refresh_addresses(c, &["10.0.0.5".into(), "100.101.7.42".into()]).unwrap());
    let dir = tempfile::tempdir().unwrap();
    let mailbox = FolderMailbox {
        root: dir.path().to_path_buf(),
    };
    sync_all(&laptop, &phone, &mailbox);
    assert_eq!(
        phone.conn(|c| lan_candidates(c).unwrap()),
        vec!["192.168.1.20", "10.0.0.5", "100.101.7.42"]
    );
}
