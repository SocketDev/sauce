use serde::{Deserialize, Serialize};
use serde_json;

#[derive(Serialize, Deserialize)]
struct Config {
    name: String,
    version: String,
}

fn main() {
    let config = Config {
        name: "test".to_string(),
        version: "0.1.0".to_string(),
    };
    let json = serde_json::to_string(&config).unwrap();
    println!("{}", json);
}
