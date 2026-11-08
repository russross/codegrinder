use std::error::Error;
use std::path::PathBuf;

fn main() -> Result<(), Box<dyn Error>> {
    // Cargo exposes the package version directly; compatibility policy is metadata.
    let manifest = std::fs::read_to_string("Cargo.toml")?.parse::<toml::Table>()?;
    let policy = &manifest["package"]["metadata"]["grind"];
    for name in ["required", "recommended"] {
        let value = policy[name].as_str().ok_or("missing grind version policy")?;
        println!("cargo:rustc-env=GRIND_VERSION_{}={value}", name.to_uppercase());
    }
    println!("cargo:rerun-if-changed=Cargo.toml");

    let proto = PathBuf::from("../protocol/codegrinder.proto");
    let includes = [PathBuf::from("../protocol"), PathBuf::from("/usr/include")];
    tonic_prost_build::configure()
        .build_client(false)
        .build_server(true)
        .btree_map(".")
        .boxed(".codegrinder.RunAuthorProblemResponse.response.progress")
        .compile_protos(&[proto], &includes)?;
    println!("cargo:rerun-if-changed=../protocol/codegrinder.proto");
    Ok(())
}
