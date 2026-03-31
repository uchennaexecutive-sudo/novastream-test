use std::env;
use std::error::Error;
use std::fs::{self, File};
use std::hash::{Hash, Hasher};
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

fn resolve_node_binary() -> Result<PathBuf, Box<dyn Error>> {
    if let Some(explicit_path) = env::var_os("NOVA_STREAM_NODE_BINARY") {
        let candidate = PathBuf::from(explicit_path);
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    #[cfg(target_os = "windows")]
    {
        let candidate = PathBuf::from(r"C:\Program Files\nodejs").join(node_binary_name());
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    find_binary_in_path(node_binary_name())
        .ok_or_else(|| format!("{} not found in PATH during build", node_binary_name()).into())
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
    let mut file = File::open(source_path)
        .map_err(|error| format!("failed to open {}: {error}", source_path.display()))?;
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer)
        .map_err(|error| format!("failed to read {}: {error}", source_path.display()))?;
    zip.write_all(&buffer)
        .map_err(|error| format!("failed to write {} into runtime archive: {error}", archive_path))?;
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
        let entry = entry.map_err(|error| format!("failed to walk {}: {error}", source_dir.display()))?;
        let path = entry.path();
        let relative = path.strip_prefix(source_dir)?;
        if relative.as_os_str().is_empty() {
            continue;
        }

        if entry.file_type().is_symlink() {
            println!("cargo:warning=skipping symlink in embedded runtime archive: {}", path.display());
            continue;
        }

        let archive_path = format!(
            "{}/{}",
            archive_root.trim_end_matches('/'),
            relative.to_string_lossy().replace('\\', "/")
        );

        if entry.file_type().is_dir() {
            zip.add_directory(format!("{archive_path}/"), options)
                .map_err(|error| format!("failed to add directory {} to runtime archive: {error}", path.display()))?;
            continue;
        }

        zip.start_file(archive_path.clone(), options)
            .map_err(|error| format!("failed to add file {} to runtime archive: {error}", path.display()))?;
        let mut file = match File::open(path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
                println!(
                    "cargo:warning=skipping unreadable embedded runtime file {}: {}",
                    path.display(),
                    error
                );
                continue;
            }
            Err(error) => {
                return Err(format!("failed to open {}: {error}", path.display()).into());
            }
        };
        let mut buffer = Vec::new();
        if let Err(error) = file.read_to_end(&mut buffer) {
            if error.kind() == std::io::ErrorKind::PermissionDenied {
                println!(
                    "cargo:warning=skipping unreadable embedded runtime file {}: {}",
                    path.display(),
                    error
                );
                continue;
            }
            return Err(format!("failed to read {}: {error}", path.display()).into());
        }
        zip.write_all(&buffer)
            .map_err(|error| format!("failed to write {} into runtime archive: {error}", path.display()))?;
    }

    Ok(())
}

fn hash_file_contents(hasher: &mut impl Hasher, file_path: &Path) -> Result<(), Box<dyn Error>> {
    let mut file = File::open(file_path)
        .map_err(|error| format!("failed to open {} for hashing: {error}", file_path.display()))?;
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer)
        .map_err(|error| format!("failed to read {} for hashing: {error}", file_path.display()))?;
    file_path.to_string_lossy().hash(hasher);
    buffer.hash(hasher);
    Ok(())
}

fn fingerprint_directory(source_dir: &Path) -> Result<u64, Box<dyn Error>> {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();

    for entry in WalkDir::new(source_dir).sort_by_file_name() {
        let entry = entry.map_err(|error| format!("failed to walk {} for hashing: {error}", source_dir.display()))?;
        let path = entry.path();
        let relative = path.strip_prefix(source_dir)?;
        relative.to_string_lossy().hash(&mut hasher);

        if entry.file_type().is_file() {
            hash_file_contents(&mut hasher, path)?;
        }
    }

    Ok(hasher.finish())
}

fn main() -> Result<(), Box<dyn Error>> {
    tauri_build::build();

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR")?);
    let repo_root = manifest_dir.parent().ok_or("missing repo root")?;
    let sidecar_dir = repo_root.join("vendor").join("nuvio-streams-addon");
    let node_path = resolve_node_binary()?;
    let out_dir = PathBuf::from(env::var("OUT_DIR")?);
    let archive_path = out_dir.join("nuvio-runtime.zip");
    let runtime_fingerprint = fingerprint_directory(&sidecar_dir)?;

    println!("cargo:rerun-if-changed={}", sidecar_dir.display());
    println!("cargo:rerun-if-changed={}", node_path.display());
    println!("cargo:rustc-env=NUVIO_RUNTIME_BUILD_ID={runtime_fingerprint:016x}");

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
