//! What the debt and finance widgets show, worked out from the database the
//! same way the app does.

use rusqlite::Connection;
use serde::Serialize;

use crate::error::Result;

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

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MoneySummary {
    /// Whether any account is set up yet.
    pub has_accounts: bool,
    /// My spending (split expenses at my share), in paise.
    pub spent_today: i64,
    pub spent_month: i64,
    /// Across accounts that are in use.
    pub balance: i64,
}

/// My share of expenses dated from `from` to `to` (inclusive).
fn spent(conn: &Connection, from: &str, to: &str) -> Result<i64> {
    Ok(conn.query_row(
        "SELECT coalesce(sum(max(0, t.amount_paise - coalesce((SELECT sum(d.amount_paise) FROM debts d
                 WHERE d.txn_id = t.id AND d.direction = 'owed_to_me' AND d.deleted_at IS NULL), 0))), 0)
         FROM fin_transactions t
         WHERE t.kind = 'expense' AND t.deleted_at IS NULL AND t.date BETWEEN ?1 AND ?2",
        [from, to],
        |r| r.get(0),
    )?)
}

/// Spending today and this month, and the money in all accounts.
pub fn money_summary(conn: &Connection, today: &str) -> Result<MoneySummary> {
    let accounts: i64 = conn.query_row(
        "SELECT count(*) FROM fin_accounts WHERE deleted_at IS NULL AND archived = 0",
        [],
        |r| r.get(0),
    )?;
    // Every movement into or out of an account, as in the app's `movements`.
    let balance: i64 = conn.query_row(
        "WITH live AS (SELECT id, opening_paise FROM fin_accounts WHERE deleted_at IS NULL AND archived = 0),
         moves (account_id, delta) AS (
           SELECT account_id, CASE kind WHEN 'income' THEN amount_paise ELSE -amount_paise END
             FROM fin_transactions WHERE deleted_at IS NULL AND account_id IS NOT NULL
           UNION ALL
           SELECT to_account_id, amount_paise FROM fin_transactions
             WHERE deleted_at IS NULL AND kind = 'transfer' AND to_account_id IS NOT NULL
           UNION ALL
           SELECT account_id, CASE direction WHEN 'owed_to_me' THEN -amount_paise ELSE amount_paise END
             FROM debts WHERE deleted_at IS NULL AND account_id IS NOT NULL AND txn_id IS NULL
           UNION ALL
           SELECT account_id, CASE direction WHEN 'to_me' THEN amount_paise ELSE -amount_paise END
             FROM debt_payments WHERE deleted_at IS NULL AND account_id IS NOT NULL
         )
         SELECT coalesce((SELECT sum(opening_paise) FROM live), 0)
              + coalesce((SELECT sum(delta) FROM moves WHERE account_id IN (SELECT id FROM live)), 0)",
        [],
        |r| r.get(0),
    )?;
    let month_start = format!("{}-01", &today[..7]);
    Ok(MoneySummary {
        has_accounts: accounts > 0,
        spent_today: spent(conn, today, today)?,
        spent_month: spent(conn, &month_start, today)?,
        balance,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::migrate;

    #[test]
    fn sums_balances_less_repayments() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn).unwrap();
        for (id, name) in [("r", "Rahul"), ("p", "Priya")] {
            conn.execute(
                "INSERT INTO people (id, name, created_at, updated_at, device_id) VALUES (?1, ?2, 0, 0, 'd')",
                [id, name],
            )
            .unwrap();
        }
        for (id, person, direction, amount) in [
            ("1", "r", "owed_to_me", 25000),
            ("2", "r", "owed_to_me", 5000),
            ("3", "p", "i_owe", 120000),
        ] {
            conn.execute(
                "INSERT INTO debts (id, person_id, direction, amount_paise, occurred_on, created_at, updated_at, device_id)
                 VALUES (?1, ?2, ?3, ?4, '2026-10-15', 0, 0, 'd')",
                rusqlite::params![id, person, direction, amount],
            )
            .unwrap();
        }
        conn.execute(
            "INSERT INTO debt_payments (id, person_id, direction, amount_paise, paid_on, created_at, updated_at, device_id)
             VALUES ('x', 'r', 'to_me', 10000, '2026-10-15', 0, 0, 'd')",
            [],
        )
        .unwrap();
        let s = debt_summary(&conn).unwrap();
        assert_eq!((s.owed_to_me, s.i_owe, s.net), (20000, 120000, -100000));
        assert_eq!(s.people[0].name, "Priya");
    }

    #[test]
    fn sums_my_spending_and_balances() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn).unwrap();
        conn.execute_batch(
            "INSERT INTO people (id, name, created_at, updated_at, device_id) VALUES ('r', 'Rahul', 0, 0, 'd');
             INSERT INTO fin_accounts (id, name, kind, opening_paise, color, created_at, updated_at, device_id)
               VALUES ('bank', 'Bank', 'bank', 1000000, '#000', 0, 0, 'd'), ('cash', 'Cash', 'cash', 0, '#000', 0, 0, 'd');
             INSERT INTO fin_transactions (id, kind, amount_paise, account_id, to_account_id, date, created_at, updated_at, device_id) VALUES
               ('dinner', 'expense', 120000, 'bank', NULL, '2026-10-17', 0, 0, 'd'),
               ('old', 'expense', 5000, 'bank', NULL, '2026-09-30', 0, 0, 'd'),
               ('atm', 'transfer', 200000, 'bank', 'cash', '2026-10-02', 0, 0, 'd'),
               ('pay', 'income', 500000, 'bank', NULL, '2026-10-01', 0, 0, 'd');
             INSERT INTO debts (id, person_id, direction, amount_paise, occurred_on, txn_id, created_at, updated_at, device_id)
               VALUES ('s', 'r', 'owed_to_me', 80000, '2026-10-17', 'dinner', 0, 0, 'd');
             INSERT INTO debt_payments (id, person_id, direction, amount_paise, paid_on, account_id, created_at, updated_at, device_id)
               VALUES ('back', 'r', 'to_me', 80000, '2026-10-17', 'bank', 0, 0, 'd');",
        )
        .unwrap();
        let m = money_summary(&conn, "2026-10-17").unwrap();
        assert!(m.has_accounts);
        assert_eq!((m.spent_today, m.spent_month), (40000, 40000));
        // 10,000 + 5,000 - 1,200 - 50 + 800 (Rahul paid back); the transfer stays inside.
        assert_eq!(m.balance, 1455000);
    }
}
