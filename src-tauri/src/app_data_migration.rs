use sha2::{Digest, Sha256};
use std::fs;
use std::io::{self, Read};
use std::path::Path;
use tauri::{AppHandle, Manager};

const LEGACY_IDENTIFIER: &str = "com.sunakgo.nais2forge";
const CURRENT_IDENTIFIER: &str = "com.iztaciyu.nais2forge";
const MIGRATION_MARKER: &str = ".identifier-migration-v1";

pub fn migrate_legacy_app_data(app: &AppHandle) -> Result<(), String> {
    if app.config().identifier != CURRENT_IDENTIFIER {
        return Ok(());
    }

    let mut destinations = vec![
        app.path()
            .app_data_dir()
            .map_err(|error| format!("Failed to resolve app data directory: {error}"))?,
        app.path()
            .app_local_data_dir()
            .map_err(|error| format!("Failed to resolve app local data directory: {error}"))?,
    ];
    destinations.sort();
    destinations.dedup();

    for destination in destinations {
        let parent = destination.parent().ok_or_else(|| {
            format!(
                "App data directory has no parent: {}",
                destination.display()
            )
        })?;
        migrate_directory(&parent.join(LEGACY_IDENTIFIER), &destination)?;
    }

    Ok(())
}

fn migrate_directory(source: &Path, destination: &Path) -> Result<(), String> {
    if !source.is_dir() {
        return Ok(());
    }

    let marker = destination.join(MIGRATION_MARKER);
    if marker.is_file() {
        return Ok(());
    }

    if destination.exists() {
        if !destination.is_dir() {
            return Err(format!(
                "Migration destination is not a directory: {}",
                destination.display()
            ));
        }
        if destination
            .read_dir()
            .map_err(|error| format!("Failed to inspect migration destination: {error}"))?
            .next()
            .is_some()
        {
            return Err(format!(
                "Migration destination already contains data: {}",
                destination.display()
            ));
        }
        fs::remove_dir(destination)
            .map_err(|error| format!("Failed to remove empty migration destination: {error}"))?;
    }

    let file_name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("Invalid migration destination: {}", destination.display()))?;
    let temporary = destination.with_file_name(format!("{file_name}.migration-v1.tmp"));

    copy_tree(source, &temporary)?;
    verify_tree(source, &temporary)?;
    fs::write(temporary.join(MIGRATION_MARKER), b"complete\n")
        .map_err(|error| format!("Failed to write migration marker: {error}"))?;
    fs::rename(&temporary, destination)
        .map_err(|error| format!("Failed to activate migrated app data: {error}"))?;

    if !destination.join(MIGRATION_MARKER).is_file() {
        return Err(format!(
            "Migrated app data could not be read: {}",
            destination.display()
        ));
    }

    Ok(())
}

fn copy_tree(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination)
        .map_err(|error| format!("Failed to create migration directory: {error}"))?;

    for entry in fs::read_dir(source)
        .map_err(|error| format!("Failed to read {}: {error}", source.display()))?
    {
        let entry = entry.map_err(|error| format!("Failed to read migration entry: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", entry.path().display()))?;
        let target = destination.join(entry.file_name());

        if file_type.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), &target)
                .map_err(|error| format!("Failed to copy {}: {error}", entry.path().display()))?;
        } else {
            return Err(format!(
                "Unsupported app data entry: {}",
                entry.path().display()
            ));
        }
    }

    Ok(())
}

fn verify_tree(source: &Path, destination: &Path) -> Result<(), String> {
    for entry in fs::read_dir(source)
        .map_err(|error| format!("Failed to verify {}: {error}", source.display()))?
    {
        let entry = entry.map_err(|error| format!("Failed to read verification entry: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", entry.path().display()))?;
        let target = destination.join(entry.file_name());

        if file_type.is_dir() {
            if !target.is_dir() {
                return Err(format!(
                    "Migrated directory is missing: {}",
                    target.display()
                ));
            }
            verify_tree(&entry.path(), &target)?;
        } else if file_type.is_file() {
            verify_file(&entry.path(), &target)?;
        } else {
            return Err(format!(
                "Unsupported app data entry: {}",
                entry.path().display()
            ));
        }
    }

    Ok(())
}

fn verify_file(source: &Path, destination: &Path) -> Result<(), String> {
    let source_metadata = fs::metadata(source)
        .map_err(|error| format!("Failed to inspect {}: {error}", source.display()))?;
    let destination_metadata = fs::metadata(destination).map_err(|error| {
        format!(
            "Migrated file is missing {}: {error}",
            destination.display()
        )
    })?;
    if source_metadata.len() != destination_metadata.len()
        || file_digest(source)
            .map_err(|error| format!("Failed to hash {}: {error}", source.display()))?
            != file_digest(destination)
                .map_err(|error| format!("Failed to hash {}: {error}", destination.display()))?
    {
        return Err(format!(
            "Migrated file verification failed: {}",
            destination.display()
        ));
    }
    Ok(())
}

fn file_digest(path: &Path) -> io::Result<[u8; 32]> {
    let mut file = fs::File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(digest.finalize().into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_root(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("nais2-{name}-{}-{nonce}", std::process::id()))
    }

    #[test]
    fn copies_verifies_and_preserves_legacy_data() {
        let root = test_root("app-data-migration");
        let source = root.join(LEGACY_IDENTIFIER);
        let destination = root.join(CURRENT_IDENTIFIER);
        fs::create_dir_all(source.join("nested")).unwrap();
        fs::write(source.join("state.sqlite3"), b"state").unwrap();
        fs::write(source.join("nested").join("settings.json"), b"settings").unwrap();

        migrate_directory(&source, &destination).unwrap();

        assert_eq!(fs::read(source.join("state.sqlite3")).unwrap(), b"state");
        assert_eq!(
            fs::read(destination.join("state.sqlite3")).unwrap(),
            b"state"
        );
        assert_eq!(
            fs::read(destination.join("nested").join("settings.json")).unwrap(),
            b"settings"
        );
        assert!(destination.join(MIGRATION_MARKER).is_file());
        migrate_directory(&source, &destination).unwrap();

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_to_overwrite_existing_destination_data() {
        let root = test_root("app-data-conflict");
        let source = root.join(LEGACY_IDENTIFIER);
        let destination = root.join(CURRENT_IDENTIFIER);
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&destination).unwrap();
        fs::write(source.join("old"), b"old").unwrap();
        fs::write(destination.join("new"), b"new").unwrap();

        assert!(migrate_directory(&source, &destination).is_err());
        assert_eq!(fs::read(source.join("old")).unwrap(), b"old");
        assert_eq!(fs::read(destination.join("new")).unwrap(), b"new");

        fs::remove_dir_all(root).unwrap();
    }
}
