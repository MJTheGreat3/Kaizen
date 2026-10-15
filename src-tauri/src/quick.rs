//! What the debt widget shows: who owes whom on balance, worked out from
//! the database the same way the app does.

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
}
