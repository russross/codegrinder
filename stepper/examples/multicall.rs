use std::env;
use std::process::ExitCode;

fn main() -> ExitCode {
    let mut args = env::args_os();
    let program = args.next().unwrap_or_default();
    if stepper::invoked_as_stepper(&program) {
        return stepper::run(args);
    }

    // The host application's other command modes dispatch from this branch.
    println!("multicall host; invoke through a symlink named stepper to run transcripts");
    ExitCode::SUCCESS
}
