"""Live view of the RoadWatch SQLite database.

Polls the database read-only and reprints a snapshot every couple of seconds so
you can watch rows appear and change while you use the app.  The connection is
opened read-only, so this can never take a lock the API server needs.

    python watch_db.py                 # refresh every 2s
    python watch_db.py --once          # one snapshot, no clearing
    python watch_db.py --interval 5
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent
DEFAULT_DB = BACKEND_ROOT / "roadwatch.db"


def connect(db_path: Path) -> sqlite3.Connection:
    # mode=ro: the watcher must never take a write lock on the live database.
    return sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True, timeout=5)


def table_counts(conn: sqlite3.Connection) -> dict[str, int]:
    names = [
        row[0]
        for row in conn.execute(
            "select name from sqlite_master where type='table' "
            "and name not like 'sqlite_%' and name <> 'alembic_version' order by name"
        )
    ]
    return {name: conn.execute(f'select count(*) from "{name}"').fetchone()[0] for name in names}


def recent_complaints(conn: sqlite3.Connection, limit: int = 8) -> list[tuple]:
    return conn.execute(
        "select complaint_number, status, priority_level, priority_score, road_name, updated_at "
        "from complaints order by updated_at desc limit ?",
        (limit,),
    ).fetchall()


def recent_changes(conn: sqlite3.Connection, limit: int = 8) -> list[tuple]:
    return conn.execute(
        "select c.complaint_number, h.from_status, h.to_status, u.full_name, h.created_at "
        "from complaint_status_history h "
        "join complaints c on c.id = h.complaint_id "
        "left join users u on u.id = h.changed_by_id "
        "order by h.created_at desc limit ?",
        (limit,),
    ).fetchall()


def short(value: object, width: int) -> str:
    """Truncate to `width`, marking cut text with a trailing tilde."""
    text = "-" if value is None else str(value)
    return text if len(text) <= width else text[: width - 1] + "~"


def stamp(value: object) -> str:
    """Timestamps are stored with microseconds; seconds are enough to watch."""
    return "-" if value is None else str(value)[:19]


def score_text(value: object) -> str:
    return f"{value:.1f}" if isinstance(value, int | float) else "-"


def render(counts, baseline, previous, complaints, changes, db_path, tick) -> str:
    out: list[str] = []
    out.append(f"RoadWatch SQLite  --  {db_path}")
    out.append(f"{datetime.now():%H:%M:%S}   refresh #{tick}   (Ctrl+C to stop)")

    out.append("")
    out.append(f"{'TABLE':<28}{'ROWS':>8}{'SINCE START':>14}")
    out.append("-" * 56)
    for name, count in counts.items():
        total = count - baseline.get(name, count)
        changed = count != previous.get(name, count)
        total_col = f"+{total}" if total > 0 else ("" if total == 0 else str(total))
        out.append(f"{name:<28}{count:>8}{total_col:>14}{'  <<< changed' if changed else ''}")

    out.append("")
    out.append("MOST RECENTLY UPDATED REPORTS")
    out.append(f"{'NUMBER':<16}{'STATUS':<14}{'PRIORITY':<11}{'SCORE':>6}  {'ROAD':<24}{'UPDATED':<20}")
    out.append("-" * 92)
    for number, status, level, score, road, updated in complaints:
        head = f"{short(number, 15):<16}{short(status, 13):<14}{short(level, 10):<11}"
        out.append(f"{head}{score_text(score):>6}  {short(road, 23):<24}{stamp(updated):<20}")

    out.append("")
    out.append("LATEST STATUS CHANGES")
    out.append(f"{'NUMBER':<16}{'TRANSITION':<34}{'BY':<22}{'WHEN':<20}")
    out.append("-" * 92)
    for number, from_status, to_status, who, when in changes:
        transition = f"{from_status or 'new'} -> {to_status}"
        head = f"{short(number, 15):<16}{short(transition, 33):<34}"
        out.append(f"{head}{short(who, 21):<22}{stamp(when):<20}")

    return "\n".join(out)


def main() -> int:
    parser = argparse.ArgumentParser(description="Live view of the RoadWatch SQLite database.")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB, help="path to roadwatch.db")
    parser.add_argument("--interval", type=float, default=2.0, help="seconds between refreshes")
    parser.add_argument("--once", action="store_true", help="print a single snapshot and exit")
    args = parser.parse_args()

    db_path = args.db.resolve()
    if not db_path.exists():
        print(f"No database at {db_path}", file=sys.stderr)
        return 1

    conn = connect(db_path)
    baseline = table_counts(conn)
    previous = dict(baseline)
    tick = 0

    try:
        while True:
            tick += 1
            counts = table_counts(conn)
            frame = render(
                counts,
                baseline,
                previous,
                recent_complaints(conn),
                recent_changes(conn),
                db_path,
                tick,
            )
            if not args.once:
                os.system("cls" if os.name == "nt" else "clear")
            print(frame)
            previous = counts
            if args.once:
                return 0
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\nstopped")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
