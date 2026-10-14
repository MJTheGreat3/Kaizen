//! Photos from Wikipedia, for players ESPN and Cricbuzz have none for.

use super::Sport;
use crate::practice::codeforces::urlencode;
use crate::practice::http::Http;

/// Lowercase, with the accents of Latin letters dropped, so `Dončić`
/// matches `Doncic`.
fn fold(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| match c {
            'à'..='å' | 'ā' | 'ă' | 'ą' => 'a',
            'ç' | 'ć' | 'ĉ' | 'ċ' | 'č' => 'c',
            'ď' | 'đ' => 'd',
            'è'..='ë' | 'ē' | 'ė' | 'ę' | 'ě' => 'e',
            'ğ' | 'ģ' => 'g',
            'ì'..='ï' | 'ī' | 'į' | 'ı' => 'i',
            'ł' | 'ľ' | 'ĺ' | 'ļ' => 'l',
            'ñ' | 'ń' | 'ň' | 'ņ' => 'n',
            'ò'..='ö' | 'ø' | 'ō' | 'ő' => 'o',
            'ř' | 'ŕ' => 'r',
            'ś' | 'š' | 'ş' | 'ș' => 's',
            'ť' | 'ţ' | 'ț' => 't',
            'ù'..='ü' | 'ū' | 'ů' | 'ű' | 'ų' => 'u',
            'ý' | 'ÿ' => 'y',
            'ź' | 'ż' | 'ž' => 'z',
            c => c,
        })
        .collect()
}

/// Whether a Wikipedia article title names this player.
pub fn names(title: &str, name: &str) -> bool {
    let title = fold(title);
    fold(name)
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.len() > 1)
        .all(|w| title.contains(w))
}

/// The lead image of the player's Wikipedia article, if the top search hit
/// is their article and it has one.
pub fn wikipedia(http: &Http, name: &str, sport: Sport) -> Option<String> {
    let what = match sport {
        Sport::Nba => "basketball player",
        Sport::Football => "footballer",
        Sport::Cricket => "cricketer",
    };
    let url = format!(
        "https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrlimit=1\
         &prop=pageimages&piprop=thumbnail&pithumbsize=330&gsrsearch={}",
        urlencode(&format!("{name} {what}"))
    );
    let json = http.json(&url).ok()?;
    let page = json["query"]["pages"].as_object()?.values().next()?;
    if !names(page["title"].as_str()?, name) {
        return None;
    }
    let src = page["thumbnail"]["source"].as_str()?;
    Some(src.split('?').next().unwrap_or(src).to_string())
}
