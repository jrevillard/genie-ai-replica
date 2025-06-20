# ArangoDB Directory

Use `docker-compose up -d` to start the ArangoDB server.

If it's already running, verify with `docker ps` and `docker logs arango-vector-db`.

See the `/root/arango_data` directory for the database files (attached to the container).

Use `sh dump.sh` to dump the database to `/root/arango_backups/`

Use `sh restore.sh <backup_time>` to restore the database from a backup.

The backup time is the timestamp of the backup you want to restore from.