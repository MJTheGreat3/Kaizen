//! Typing into the phone's widgets without opening the app: a small entry
//! box over the home screen hands its text here, and it is parsed and saved
//! straight into the database (opened with the fingerprint-unlock key).
//!
//! The app parses with chrono-node; this covers the everyday phrasings:
//! today, tomorrow, yesterday, weekdays ("fri", "next monday"), "in 3 days",
//! times ("5pm", "5:30 pm", "17:00", "at 5"), repeats, #tags, ! priority,
//! and the debt sentences the app understands.

use chrono::{Datelike, Duration, NaiveDate, Weekday};
use regex::Regex;
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

use crate::error::{Error, Result};

#[derive(Debug, PartialEq)]
pub struct Task {
    pub title: String,
    pub due_date: Option<NaiveDate>,
    pub due_time: Option<String>,
    pub recurrence: Option<&'static str>,
    pub priority: i64,
    pub tags: Vec<String>,
}

fn squash(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn weekday(word: &str) -> Option<Weekday> {
    let w = word.to_lowercase();
    let days = [
        ("mon", Weekday::Mon),
        ("tue", Weekday::Tue),
        ("wed", Weekday::Wed),
        ("thu", Weekday::Thu),
        ("fri", Weekday::Fri),
        ("sat", Weekday::Sat),
        ("sun", Weekday::Sun),
    ];
    days.iter().find(|(p, _)| w.starts_with(p)).map(|(_, d)| *d)
}

/// The next `day` after `today` ("friday" and "next friday" both mean the coming one).
fn next_weekday(today: NaiveDate, day: Weekday) -> NaiveDate {
    let ahead =
        (day.num_days_from_monday() as i64 - today.weekday().num_days_from_monday() as i64 + 7) % 7;
    today + Duration::days(if ahead == 0 { 7 } else { ahead })
}

const WEEKDAY: &str = r"(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)";

/// Takes a date phrase out of `text`; returns the date. `past` reads bare
/// weekdays backwards (debts happened already).
fn take_date(text: &mut String, today: NaiveDate, past: bool) -> Option<NaiveDate> {
    let patterns: [(&str, u8); 6] = [
        (r"(?i)\b(?:on\s+)?(today|tonight)\b", 0),
        (r"(?i)\b(?:on\s+)?(tomorrow|tmrw|tmr)\b", 1),
        (r"(?i)\b(?:on\s+)?(yesterday)\b", 2),
        (r"(?i)\bin\s+(\d{1,3})\s+days?\b", 3),
        (
            &format!(r"(?i)\b(?:on\s+)?(next|this|last)\s+{WEEKDAY}\b"),
            4,
        ),
        (&format!(r"(?i)\b(?:on\s+|by\s+)?{WEEKDAY}\b"), 5),
    ];
    for (pattern, kind) in patterns {
        let re = Regex::new(pattern).unwrap();
        let Some(m) = re.captures(text) else { continue };
        let date = match kind {
            0 => today,
            1 => today + Duration::days(1),
            2 => today - Duration::days(1),
            3 => today + Duration::days(m[1].parse::<i64>().unwrap_or(0)),
            4 => {
                let day = weekday(&m[2])?;
                if m[1].eq_ignore_ascii_case("last") {
                    let back = (today.weekday().num_days_from_monday() as i64
                        - day.num_days_from_monday() as i64
                        + 7)
                        % 7;
                    today - Duration::days(if back == 0 { 7 } else { back })
                } else {
                    next_weekday(today, day)
                }
            }
            _ => {
                let day = weekday(&m[1])?;
                if past {
                    let back = (today.weekday().num_days_from_monday() as i64
                        - day.num_days_from_monday() as i64
                        + 7)
                        % 7;
                    today - Duration::days(back)
                } else {
                    next_weekday(today, day)
                }
            }
        };
        let range = m.get(0).unwrap().range();
        text.replace_range(range, " ");
        return Some(date);
    }
    None
}

/// Takes a time ("5pm", "5:30 pm", "17:00", "at 5", "noon") out of `text`, as `HH:MM`.
fn take_time(text: &mut String) -> Option<String> {
    let patterns = [
        r"(?i)\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b",
        r"(?i)\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b",
        r"(?i)\bat\s+(\d{1,2})\b",
        r"(?i)\b(?:at\s+)?(noon|midnight)\b",
    ];
    for (i, pattern) in patterns.iter().enumerate() {
        let re = Regex::new(pattern).unwrap();
        let Some(m) = re.captures(text) else { continue };
        let (h, min) = match i {
            0 => {
                let h: u32 = m[1].parse().ok()?;
                let min: u32 = m.get(2).map_or(Some(0), |x| x.as_str().parse().ok())?;
                if h == 0 || h > 12 || min > 59 {
                    continue;
                }
                let pm = m[3].eq_ignore_ascii_case("pm");
                ((h % 12) + if pm { 12 } else { 0 }, min)
            }
            1 => (m[1].parse().ok()?, m[2].parse().ok()?),
            2 => {
                let h: u32 = m[1].parse().ok()?;
                if h == 0 || h > 12 {
                    continue;
                }
                // "at 5" means the afternoon for small hours, as people say it.
                (if h < 8 { h + 12 } else { h }, 0)
            }
            _ => (
                if m[1].eq_ignore_ascii_case("noon") {
                    12
                } else {
                    0
                },
                0,
            ),
        };
        let range = m.get(0).unwrap().range();
        text.replace_range(range, " ");
        return Some(format!("{h:02}:{min:02}"));
    }
    None
}

pub fn parse_task(input: &str, today: NaiveDate) -> Task {
    let mut text = format!(" {input} ");
    let mut tags = Vec::new();
    let tag = Regex::new(r"\s#([\p{L}\p{N}_-]+)").unwrap();
    for c in tag.captures_iter(&text.clone()) {
        tags.push(c[1].to_lowercase());
    }
    text = tag.replace_all(&text, " ").into_owned();

    let mut priority = 0;
    // The regex crate has no look-ahead; the mark is matched with its trailing space.
    let bang = Regex::new(r"(?i)\s(!{1,3}|!high|!med(?:ium)?|!low|![123])\s").unwrap();
    if let Some(m) = bang.captures(&text) {
        let mark = m[1].to_lowercase();
        priority = if mark == "!!!" || mark == "!high" || mark == "!3" {
            3
        } else if mark == "!!" || mark.starts_with("!med") || mark == "!2" {
            2
        } else {
            1
        };
        text = bang.replace(&text, " ").into_owned();
    }

    let mut recurrence = None;
    let every_weekday = Regex::new(&format!(r"(?i)\bevery\s+{WEEKDAY}\b")).unwrap();
    if let Some(m) = every_weekday.captures(&text) {
        recurrence = Some("weekly");
        let day = m[1].to_string();
        text = every_weekday.replace(&text, day.as_str()).into_owned();
    } else {
        let rules: [(&str, &'static str); 5] = [
            (r"(?i)\bevery\s*day\b|\bdaily\b", "daily"),
            (r"(?i)\bevery\s*weekday\b|\bon\s+weekdays\b", "weekdays"),
            (r"(?i)\bevery\s*week\b|\bweekly\b", "weekly"),
            (r"(?i)\bevery\s*month\b|\bmonthly\b", "monthly"),
            (r"(?i)\bevery\s*year\b|\byearly\b|\bannually\b", "yearly"),
        ];
        for (pattern, rule) in rules {
            let re = Regex::new(pattern).unwrap();
            if re.is_match(&text) {
                recurrence = Some(rule);
                text = re.replace(&text, " ").into_owned();
                break;
            }
        }
    }

    let mut due_date = take_date(&mut text, today, false);
    let due_time = take_time(&mut text);
    if due_time.is_some() && due_date.is_none() {
        due_date = Some(today);
    }
    if recurrence.is_some() && due_date.is_none() {
        due_date = Some(today);
    }
    let dangling = Regex::new(r"(?i)\s(by|on|at|due|before)\s*$").unwrap();
    let title = squash(&dangling.replace(&squash(&text), ""));
    Task {
        title,
        due_date,
        due_time,
        recurrence,
        priority,
        tags,
    }
}

#[derive(Debug, PartialEq)]
pub struct Debt {
    /// "debt" or "payment".
    pub kind: &'static str,
    pub person: String,
    /// owed_to_me / i_owe for debts, to_me / from_me for payments.
    pub direction: &'static str,
    pub amount_paise: i64,
    pub reason: Option<String>,
    pub on: NaiveDate,
}

fn rupees(amount: &str) -> Option<i64> {
    let cleaned = amount.trim().to_lowercase().replace(',', "");
    let (num, k) = match cleaned.strip_suffix('k') {
        Some(n) => (n.trim().to_string(), 1000.0),
        None => (cleaned, 1.0),
    };
    let value: f64 = num.parse().ok()?;
    (value > 0.0).then(|| (value * k * 100.0).round() as i64)
}

fn clean_name(name: &str) -> String {
    squash(name)
        .split(' ')
        .map(|w| {
            let mut c = w.chars();
            c.next()
                .map(|f| f.to_uppercase().collect::<String>() + c.as_str())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn parse_debt(input: &str, today: NaiveDate) -> Option<Debt> {
    let mut text = format!(" {} ", input.trim());
    let on = take_date(&mut text, today, true).unwrap_or(today);
    let text = squash(
        &Regex::new(r"(?i)\s+(on|at)$")
            .unwrap()
            .replace(&squash(&text), ""),
    );
    const AMOUNT: &str = r"(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?\s*k?)";
    const NAME: &str = r"(\p{L}[\p{L} .'-]*?)";
    const REST: &str = r"(?:\s+(?:for|towards|because of|as)\s+(.+))?";
    // (pattern, kind, direction, name group, amount group)
    let rules: [(String, &'static str, &'static str, usize, usize); 7] = [
        (
            format!(r"(?i)^{NAME}\s+owes(?:\s+me)?\s+{AMOUNT}{REST}$"),
            "debt",
            "owed_to_me",
            1,
            2,
        ),
        (
            format!(r"(?i)^i\s+owe\s+{NAME}\s+{AMOUNT}{REST}$"),
            "debt",
            "i_owe",
            1,
            2,
        ),
        (
            format!(r"(?i)^(?:i\s+)?lent\s+{NAME}\s+{AMOUNT}{REST}$"),
            "debt",
            "owed_to_me",
            1,
            2,
        ),
        (
            format!(r"(?i)^(?:i\s+)?borrowed\s+{AMOUNT}\s+from\s+{NAME}{REST}$"),
            "debt",
            "i_owe",
            2,
            1,
        ),
        (
            format!(
                r"(?i)^{NAME}\s+(?:paid|returned|gave)(?:\s+me)?(?:\s+back)?\s+{AMOUNT}{REST}$"
            ),
            "payment",
            "to_me",
            1,
            2,
        ),
        (
            format!(r"(?i)^(?:got|received)\s+{AMOUNT}\s+(?:back\s+)?from\s+{NAME}{REST}$"),
            "payment",
            "to_me",
            2,
            1,
        ),
        (
            format!(r"(?i)^(?:i\s+)?(?:paid|returned)\s+{NAME}(?:\s+back)?\s+{AMOUNT}{REST}$"),
            "payment",
            "from_me",
            1,
            2,
        ),
    ];
    for (pattern, kind, direction, name, amount) in rules {
        let Some(m) = Regex::new(&pattern).unwrap().captures(&text) else {
            continue;
        };
        let Some(amount_paise) = rupees(&m[amount]) else {
            continue;
        };
        return Some(Debt {
            kind,
            person: clean_name(&m[name]),
            direction,
            amount_paise,
            reason: m
                .get(3)
                .map(|r| r.as_str().trim().to_string())
                .filter(|r| !r.is_empty()),
            on,
        });
    }
    None
}

fn day(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

/// Saves a task typed into the widget; returns a line for the confirmation.
pub fn add_task(conn: &Connection, input: &str, today: NaiveDate, device: &str) -> Result<String> {
    let t = parse_task(input, today);
    if t.title.is_empty() {
        return Err(Error::Invalid("Write what the task is".into()));
    }
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute(
        "INSERT INTO tasks (id, list, title, due_date, due_time, remind, recurrence, priority, tags, created_at, updated_at, device_id)
         VALUES (?1, 'todo', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?10)",
        params![
            uuid::Uuid::now_v7().to_string(),
            t.title,
            t.due_date.map(day),
            t.due_time,
            t.due_time.is_some(),
            t.recurrence,
            t.priority,
            serde_json::to_string(&t.tags)?,
            now,
            device
        ],
    )?;
    let when = match (t.due_date, &t.due_time) {
        (Some(d), Some(time)) => format!(" · {} {time}", d.format("%a %-d %b")),
        (Some(d), None) => format!(" · {}", d.format("%a %-d %b")),
        _ => String::new(),
    };
    Ok(format!("Added: {}{when}", t.title))
}

/// Saves a debt or repayment typed into the widget.
pub fn add_debt(conn: &Connection, input: &str, today: NaiveDate, device: &str) -> Result<String> {
    let d = parse_debt(input, today).ok_or_else(|| {
        Error::Invalid("Try \"Rahul owes 250 for pizza\" or \"I owe Priya 1200\"".into())
    })?;
    let now = chrono::Utc::now().timestamp_millis();
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM people WHERE deleted_at IS NULL AND lower(trim(name)) = lower(trim(?1)) LIMIT 1",
            [&d.person],
            |r| r.get(0),
        )
        .optional()?;
    let person = match existing {
        Some(id) => id,
        None => {
            let id = uuid::Uuid::now_v7().to_string();
            conn.execute(
                "INSERT INTO people (id, name, created_at, updated_at, device_id) VALUES (?1, ?2, ?3, ?3, ?4)",
                params![id, d.person, now, device],
            )?;
            id
        }
    };
    if d.kind == "debt" {
        conn.execute(
            "INSERT INTO debts (id, person_id, direction, amount_paise, occurred_on, reason, created_at, updated_at, device_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8)",
            params![uuid::Uuid::now_v7().to_string(), person, d.direction, d.amount_paise, day(d.on), d.reason, now, device],
        )?;
    } else {
        conn.execute(
            "INSERT INTO debt_payments (id, person_id, direction, amount_paise, paid_on, note, created_at, updated_at, device_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8)",
            params![uuid::Uuid::now_v7().to_string(), person, d.direction, d.amount_paise, day(d.on), d.reason, now, device],
        )?;
    }
    let amount = format!("₹{}", d.amount_paise as f64 / 100.0);
    Ok(match (d.kind, d.direction) {
        ("debt", "owed_to_me") => format!("{} owes you {amount}", d.person),
        ("debt", _) => format!("You owe {} {amount}", d.person),
        (_, "to_me") => format!("{} paid you {amount}", d.person),
        _ => format!("You paid {} {amount}", d.person),
    })
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DebtPerson {
    pub name: String,
    /// Paise; positive when they owe you.
    pub balance: i64,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DebtSummary {
    pub owed_to_me: i64,
    pub i_owe: i64,
    pub net: i64,
    /// The biggest balances, largest first.
    pub people: Vec<DebtPerson>,
}

/// Balances per person (debts less repayments), as the app works them out.
pub fn debt_summary(conn: &Connection) -> Result<DebtSummary> {
    let mut stmt = conn.prepare(
        "SELECT p.name,
           coalesce((SELECT sum(CASE WHEN d.direction = 'owed_to_me' THEN d.amount_paise ELSE -d.amount_paise END)
                     FROM debts d WHERE d.person_id = p.id AND d.deleted_at IS NULL), 0)
         - coalesce((SELECT sum(CASE WHEN x.direction = 'to_me' THEN x.amount_paise ELSE -x.amount_paise END)
                     FROM debt_payments x WHERE x.person_id = p.id AND x.deleted_at IS NULL), 0)
         FROM people p WHERE p.deleted_at IS NULL",
    )?;
    let mut people: Vec<DebtPerson> = stmt
        .query_map([], |r| {
            Ok(DebtPerson {
                name: r.get(0)?,
                balance: r.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?
        .into_iter()
        .filter(|p| p.balance != 0)
        .collect();
    let owed_to_me = people
        .iter()
        .filter(|p| p.balance > 0)
        .map(|p| p.balance)
        .sum();
    let i_owe = -people
        .iter()
        .filter(|p| p.balance < 0)
        .map(|p| p.balance)
        .sum::<i64>();
    people.sort_by_key(|p| -p.balance.abs());
    people.truncate(3);
    Ok(DebtSummary {
        owed_to_me,
        i_owe,
        net: owed_to_me - i_owe,
        people,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::migrate;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }
    // A Thursday.
    const TODAY: &str = "2026-10-15";

    #[test]
    fn reads_tasks_like_the_app() {
        let t = parse_task("Submit OS assignment friday 5pm #college !!", d(TODAY));
        assert_eq!(t.title, "Submit OS assignment");
        assert_eq!(t.due_date, Some(d("2026-10-16")));
        assert_eq!(t.due_time.as_deref(), Some("17:00"));
        assert_eq!(t.priority, 2);
        assert_eq!(t.tags, vec!["college"]);

        let t = parse_task("call mom tomorrow at 7:30 pm", d(TODAY));
        assert_eq!(
            (t.title.as_str(), t.due_date, t.due_time.as_deref()),
            ("call mom", Some(d("2026-10-16")), Some("19:30"))
        );

        let t = parse_task("gym every monday", d(TODAY));
        assert_eq!(
            (t.title.as_str(), t.recurrence, t.due_date),
            ("gym", Some("weekly"), Some(d("2026-10-19")))
        );

        let t = parse_task("water plants daily", d(TODAY));
        assert_eq!(
            (t.title.as_str(), t.recurrence, t.due_date),
            ("water plants", Some("daily"), Some(d(TODAY)))
        );

        let t = parse_task("Buy kurta", d(TODAY));
        assert_eq!(
            (t.title.as_str(), t.due_date, t.due_time),
            ("Buy kurta", None, None)
        );

        let t = parse_task("pay rent in 3 days", d(TODAY));
        assert_eq!(t.due_date, Some(d("2026-10-18")));
        let t = parse_task("standup at 10", d(TODAY));
        assert_eq!(
            (t.title.as_str(), t.due_time.as_deref()),
            ("standup", Some("10:00"))
        );
    }

    #[test]
    fn reads_debts_like_the_app() {
        let x = parse_debt("Rahul owes 250 for pizza", d(TODAY)).unwrap();
        assert_eq!(
            (
                x.kind,
                x.person.as_str(),
                x.direction,
                x.amount_paise,
                x.reason.as_deref()
            ),
            ("debt", "Rahul", "owed_to_me", 25000, Some("pizza"))
        );
        let x = parse_debt("I owe priya 1.2k for the cab yesterday", d(TODAY)).unwrap();
        assert_eq!(
            (x.person.as_str(), x.direction, x.amount_paise, x.on),
            ("Priya", "i_owe", 120000, d("2026-10-14"))
        );
        let x = parse_debt("borrowed ₹500 from Amit", d(TODAY)).unwrap();
        assert_eq!(
            (x.person.as_str(), x.direction, x.amount_paise),
            ("Amit", "i_owe", 50000)
        );
        let x = parse_debt("Rahul paid me back 100", d(TODAY)).unwrap();
        assert_eq!(
            (x.kind, x.direction, x.amount_paise),
            ("payment", "to_me", 10000)
        );
        assert!(parse_debt("dinner was great", d(TODAY)).is_none());
    }

    #[test]
    fn saves_entries_and_sums_balances() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn).unwrap();
        add_debt(&conn, "Rahul owes 250 for pizza", d(TODAY), "d").unwrap();
        add_debt(&conn, "rahul owes 50", d(TODAY), "d").unwrap();
        add_debt(&conn, "I owe Priya 1200", d(TODAY), "d").unwrap();
        add_debt(&conn, "Rahul paid me 100", d(TODAY), "d").unwrap();
        let people: i64 = conn
            .query_row("SELECT count(*) FROM people", [], |r| r.get(0))
            .unwrap();
        assert_eq!(people, 2);
        let s = debt_summary(&conn).unwrap();
        assert_eq!((s.owed_to_me, s.i_owe, s.net), (20000, 120000, -100000));
        assert_eq!(s.people[0].name, "Priya");
        let line = add_task(&conn, "Buy milk tomorrow 8am", d(TODAY), "d").unwrap();
        assert!(line.starts_with("Added: Buy milk"), "{line}");
    }
}
