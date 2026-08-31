use std::fs;
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
        move_directory(&parent.join(LEGACY_IDENTIFIER), &destination)?;
    }

    Ok(())
}

fn move_directory(source: &Path, destination: &Path) -> Result<(), String> {
    let marker = destination.join(MIGRATION_MARKER);
    if marker.is_file() {
        return Ok(());
    }

    let file_name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("Invalid migration destination: {}", destination.display()))?;
    let temporary = destination.with_file_name(format!("{file_name}.migration-v1.tmp"));

    if temporary.exists() {
        if source.exists() || destination.exists() {
            return Err(format!(
                "Migration paths contain conflicting data beside {}",
                temporary.display()
            ));
        }
        return activate_temporary_directory(&temporary, destination);
    }

    if !source.is_dir() {
        if source.exists() {
            return Err(format!(
                "Legacy app data path is not a directory: {}",
                source.display()
            ));
        }
        if destination.exists() {
            return Err(format!(
                "Unverified migration destination already exists: {}",
                destination.display()
            ));
        }
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

    fs::rename(source, &temporary)
        .map_err(|error| format!("Failed to move legacy app data: {error}"))?;
    activate_temporary_directory(&temporary, destination)
}

fn activate_temporary_directory(temporary: &Path, destination: &Path) -> Result<(), String> {
    let before = tree_stats(temporary)?;
    fs::write(temporary.join(MIGRATION_MARKER), b"complete\n")
        .map_err(|error| format!("Failed to write migration marker: {error}"))?;
    fs::rename(&temporary, destination)
        .map_err(|error| format!("Failed to activate migrated app data: {error}"))?;

    if !destination.join(MIGRATION_MARKER).is_file() || tree_stats(destination)? != before {
        return Err(format!(
            "Migrated app data could not be read: {}",
            destination.display()
        ));
    }

    Ok(())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct TreeStats {
    files: u64,
    bytes: u64,
}

fn tree_stats(directory: &Path) -> Result<TreeStats, String> {
    let mut stats = TreeStats { files: 0, bytes: 0 };
    for entry in fs::read_dir(directory)
        .map_err(|error| format!("Failed to inspect {}: {error}", directory.display()))?
    {
        let entry = entry.map_err(|error| format!("Failed to inspect migration entry: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", entry.path().display()))?;

        if file_type.is_dir() {
            let child = tree_stats(&entry.path())?;
            stats.files += child.files;
            stats.bytes += child.bytes;
        } else if file_type.is_file() {
            if entry.file_name() != MIGRATION_MARKER {
                stats.files += 1;
                stats.bytes += entry
                    .metadata()
                    .map_err(|error| {
                        format!("Failed to inspect {}: {error}", entry.path().display())
                    })?
                    .len();
            }
        } else {
            return Err(format!(
                "Unsupported app data entry: {}",
                entry.path().display()
            ));
        }
    }

    Ok(stats)
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
    fn moves_and_verifies_legacy_data() {
        let root = test_root("app-data-migration");
        let source = root.join(LEGACY_IDENTIFIER);
        let destination = root.join(CURRENT_IDENTIFIER);
        fs::create_dir_all(source.join("nested")).unwrap();
        fs::write(source.join("state.sqlite3"), b"state").unwrap();
        fs::write(source.join("nested").join("settings.json"), b"settings").unwrap();

        move_directory(&source, &destination).unwrap();

        assert!(!source.exists());
        assert_eq!(
            fs::read(destination.join("state.sqlite3")).unwrap(),
            b"state"
        );
        assert_eq!(
            fs::read(destination.join("nested").join("settings.json")).unwrap(),
            b"settings"
        );
        assert!(destination.join(MIGRATION_MARKER).is_file());
        move_directory(&source, &destination).unwrap();

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

        assert!(move_directory(&source, &destination).is_err());
        assert_eq!(fs::read(source.join("old")).unwrap(), b"old");
        assert_eq!(fs::read(destination.join("new")).unwrap(), b"new");

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn resumes_after_interruption_at_temporary_directory() {
        let root = test_root("app-data-resume");
        let source = root.join(LEGACY_IDENTIFIER);
        let destination = root.join(CURRENT_IDENTIFIER);
        let temporary = root.join(format!("{CURRENT_IDENTIFIER}.migration-v1.tmp"));
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("state"), b"state").unwrap();
        fs::rename(&source, &temporary).unwrap();

        move_directory(&source, &destination).unwrap();

        assert!(!source.exists());
        assert!(!temporary.exists());
        assert_eq!(fs::read(destination.join("state")).unwrap(), b"state");

        fs::remove_dir_all(root).unwrap();
    }
}
