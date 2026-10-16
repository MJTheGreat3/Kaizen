//! Small HTTP client for the practice platforms, with a browser-like user
//! agent (LeetCode and CodeChef reject unknown clients) and polite pauses.

use std::thread::sleep;
use std::time::Duration;

use serde_json::Value as JsonValue;

use crate::error::{Error, Result};

const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 Kaizen";

pub struct Http {
    agent: ureq::Agent,
}

impl Http {
    pub fn new() -> Self {
        Self {
            agent: ureq::Agent::config_builder()
                .timeout_global(Some(Duration::from_secs(45)))
                .http_status_as_error(false)
                .user_agent(USER_AGENT)
                .build()
                .into(),
        }
    }

    /// Status and body, whatever the status.
    pub fn raw(&self, url: &str) -> Result<(u16, String)> {
        let mut resp = self.agent.get(url).call().map_err(http_err)?;
        let status = resp.status().as_u16();
        let body = resp
            .body_mut()
            .with_config()
            .limit(32 * 1024 * 1024)
            .read_to_string()
            .map_err(http_err)?;
        Ok((status, body))
    }

    pub fn text(&self, url: &str) -> Result<String> {
        let (status, body) = self.raw(url)?;
        if !(200..300).contains(&status) {
            return Err(Error::Http(format!("{} returned {status}", host(url))));
        }
        Ok(body)
    }

    pub fn json(&self, url: &str) -> Result<JsonValue> {
        Ok(serde_json::from_str(&self.text(url)?)?)
    }

    /// POSTs JSON and reads JSON back.
    pub fn post_json(&self, url: &str, body: JsonValue) -> Result<JsonValue> {
        let mut resp = self.agent.post(url).send_json(body).map_err(http_err)?;
        let status = resp.status();
        if !status.is_success() {
            return Err(Error::Http(format!("{} returned {status}", host(url))));
        }
        resp.body_mut().read_json().map_err(http_err)
    }

    /// A GraphQL request (LeetCode).
    pub fn graphql(&self, url: &str, query: &str, variables: JsonValue) -> Result<JsonValue> {
        let mut resp = self
            .agent
            .post(url)
            .header("Referer", "https://leetcode.com")
            .send_json(serde_json::json!({ "query": query, "variables": variables }))
            .map_err(http_err)?;
        let status = resp.status();
        let body: JsonValue = resp.body_mut().read_json().unwrap_or(JsonValue::Null);
        if !status.is_success() {
            return Err(Error::Http(format!("{} returned {status}", host(url))));
        }
        if let Some(errors) = body
            .get("errors")
            .and_then(|e| e.as_array())
            .filter(|e| !e.is_empty())
        {
            let message = errors[0]["message"].as_str().unwrap_or("query failed");
            return Err(Error::Http(format!("LeetCode: {message}")));
        }
        Ok(body["data"].clone())
    }
}

/// Waits between requests to the same site.
pub fn pause(ms: u64) {
    if !cfg!(test) {
        sleep(Duration::from_millis(ms));
    }
}

fn host(url: &str) -> &str {
    url.split('/').nth(2).unwrap_or(url)
}

fn http_err(e: ureq::Error) -> Error {
    Error::Http(e.to_string())
}
