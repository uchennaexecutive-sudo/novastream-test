use std::env;
use std::error::Error;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

fn node_binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "node.exe"
    } else {
        "node"
    }
}

fn find_binary_in_path(name: &str) -> Option<PathBuf> {
    let path_var = env::var_os("PATH")?;

    for directory in env::split_paths(&path_var) {
        let candidate = directory.join(name);
        if candidate.exists() {
            return Some(candidate);
        }
    }

    None
}

fn zip_file(
    zip: &mut ZipWriter<File>,
    source_path: &Path,
    archive_path: &str,
) -> Result<(), Box<dyn Error>> {
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o755);

    zip.start_file(archive_path.replace('\\', "/"), options)?;
    let mut file = File::open(source_path)?;
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer)?;
    zip.write_all(&buffer)?;
    Ok(())
}

fn zip_directory(
    zip: &mut ZipWriter<File>,
    source_dir: &Path,
    archive_root: &str,
) -> Result<(), Box<dyn Error>> {
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o755);

    for entry in WalkDir::new(source_dir) {
        let entry = entry?;
        let path = entry.path();
        let relative = path.strip_prefix(source_dir)?;
        if relative.as_os_str().is_empty() {
            continue;
        }

        let archive_path = format!(
            "{}/{}",
            archive_root.trim_end_matches('/'),
            relative.to_string_lossy().replace('\\', "/")
        );

        if entry.file_type().is_dir() {
            zip.add_directory(format!("{archive_path}/"), options)?;
            continue;
        }

        zip.start_file(archive_path, options)?;
        let mut file = File::open(path)?;
        let mut buffer = Vec::new();
        file.read_to_end(&mut buffer)?;
        zip.write_all(&buffer)?;
    }

    Ok(())
}

fn main() -> Result<(), Box<dyn Error>> {
    tauri_build::build();

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR")?);
    let repo_root = manifest_dir.parent().ok_or("missing repo root")?;
    let sidecar_dir = repo_root.join("vendor").join("nuvio-streams-addon");
    let node_path = find_binary_in_path(node_binary_name())
        .ok_or_else(|| format!("{} not found in PATH during build", node_binary_name()))?;
    let out_dir = PathBuf::from(env::var("OUT_DIR")?);
    let archive_path = out_dir.join("nuvio-runtime.zip");

    println!("cargo:rerun-if-changed={}", sidecar_dir.display());
    println!("cargo:rerun-if-changed={}", node_path.display());

    if archive_path.exists() {
        fs::remove_file(&archive_path)?;
    }

    let archive_file = File::create(&archive_path)?;
    let mut zip = ZipWriter::new(archive_file);

    zip_directory(
        &mut zip,
        &sidecar_dir,
        "vendor/nuvio-streams-addon",
    )?;
    zip_file(
        &mut zip,
        &node_path,
        &format!("node/{}", node_binary_name()),
    )?;
    zip.finish()?;

    Ok(())
}
