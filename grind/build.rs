use std::error::Error;
use std::path::PathBuf;

fn main() -> Result<(), Box<dyn Error>> {
    let proto = PathBuf::from("../protocol/codegrinder.proto");
    let includes = [PathBuf::from("../protocol"), PathBuf::from("/usr/include")];
    tonic_prost_build::configure()
        .build_server(false)
        .btree_map(".")
        .compile_protos(&[proto], &includes)?;
    println!("cargo:rerun-if-changed=../protocol/codegrinder.proto");
    Ok(())
}
