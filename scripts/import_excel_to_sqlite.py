#!/usr/bin/env python3
"""Import safe, independent workbook records into QIConect SQLite."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import posixpath
import re
import sqlite3
import sys
import uuid
import zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
DOC_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS = {"m": MAIN_NS}
PROFILE_NAMES = {"empresa", "terapeuta", "paciente"}
USER_SHEET = "USUARIO"
IMPORTABLE_SHEETS = {"CLINICA", "ESPECIALIDADE", "TERAPIA", "PERGUNTAS"}
NAMESPACE = uuid.UUID("cc6d0645-eebd-4c12-976e-93283bdbfe30")


def column_name(cell_reference: str) -> str:
    return "".join(character for character in cell_reference if character.isalpha()).upper()


def workbook_sheets(archive: zipfile.ZipFile) -> list[tuple[str, str]]:
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    targets = {item.get("Id"): item.get("Target") for item in relationships}
    sheets = []
    for sheet in workbook.findall("m:sheets/m:sheet", NS):
        relation_id = sheet.get(f"{{{DOC_REL_NS}}}id")
        target = targets.get(relation_id)
        if not target:
            continue
        target = target.lstrip("/")
        if not target.startswith("xl/"):
            target = posixpath.normpath(posixpath.join("xl", target))
        sheets.append((sheet.get("name", ""), target))
    return sheets


def cell_text(cell: ET.Element, shared_strings: dict[int, str]) -> str:
    if cell.get("t") == "inlineStr":
        return "".join(part.text or "" for part in cell.findall(".//m:t", NS)).strip()
    value = cell.find("m:v", NS)
    if value is None:
        return ""
    text = value.text or ""
    if cell.get("t") == "s":
        try:
            return shared_strings[int(text)].strip()
        except (KeyError, ValueError, IndexError):
            return ""
    return text.strip()


def shared_string_index(cell: ET.Element) -> int | None:
    value = cell.find("m:v", NS)
    if cell.get("t") != "s" or value is None:
        return None
    try:
        return int(value.text or "")
    except ValueError:
        return None


def load_shared_strings(
    archive: zipfile.ZipFile, path: str, required_indices: set[int]
) -> dict[int, str]:
    strings: dict[int, str] = {}
    index = 0
    with archive.open(path) as xml_stream:
        for _, element in ET.iterparse(xml_stream, events=("end",)):
            if element.tag != f"{{{MAIN_NS}}}si":
                continue
            if index in required_indices:
                strings[index] = "".join(
                    part.text or "" for part in element.findall(".//m:t", NS)
                ).strip()
            element.clear()
            index += 1
    return strings


def read_workbook(
    path: Path, include_nonpassword_fields: bool = False
) -> dict[str, list[dict[str, str]]]:
    with zipfile.ZipFile(path) as archive:
        sheet_files = workbook_sheets(archive)
        sheet_xml = {name: archive.read(sheet_path) for name, sheet_path in sheet_files}
        strings_path = "xl/sharedStrings.xml"
        has_shared_strings = strings_path in archive.namelist()
        sheet_roots = {
            name: ET.fromstring(xml_bytes) for name, xml_bytes in sheet_xml.items()
        }
        rows_by_sheet = {
            name: root.findall(".//m:sheetData/m:row", NS)
            for name, root in sheet_roots.items()
        }

        header_indices = {
            shared_string_index(cell)
            for rows in rows_by_sheet.values()
            if rows
            for cell in rows[0].findall("m:c", NS)
        }
        header_strings = (
            load_shared_strings(
                archive,
                strings_path,
                {index for index in header_indices if index is not None},
            )
            if has_shared_strings
            else {}
        )
        headers_by_sheet: dict[str, dict[str, str]] = {}
        selected_columns: dict[str, set[str]] = {}
        for sheet_name, xml_rows in rows_by_sheet.items():
            headers: dict[str, str] = {}
            if xml_rows:
                for cell in xml_rows[0].findall("m:c", NS):
                    headers[column_name(cell.get("r", ""))] = cell_text(
                        cell, header_strings
                    ).lower()
            headers_by_sheet[sheet_name] = headers
            if include_nonpassword_fields:
                allowed = {
                    header
                    for header in headers.values()
                    if header not in {"senha", "password", "password_hash"}
                }
            elif sheet_name == USER_SHEET:
                allowed = {"id"}
            elif sheet_name == "PERFIL":
                allowed = {"nome"}
            elif sheet_name in IMPORTABLE_SHEETS:
                allowed = {
                    "CLINICA": {
                        "id", "nome", "cnpj", "email", "telefone", "endereco",
                        "ativo", "dt_atualizacao",
                    },
                    "ESPECIALIDADE": {"id", "nome", "descricao", "ativo"},
                    "TERAPIA": {
                        "id", "especialidade_id", "nome", "descricao",
                        "duracao_min", "ativa",
                    },
                    "PERGUNTAS": {"id", "descricao"},
                }[sheet_name]
            else:
                allowed = set()
            selected_columns[sheet_name] = {
                column
                for column, header in headers.items()
                if header in allowed
            }

        required_indices: set[int] = set()
        for sheet_name, xml_rows in rows_by_sheet.items():
            selected = selected_columns[sheet_name]
            for xml_row in xml_rows[1:]:
                for cell in xml_row.findall("m:c", NS):
                    if column_name(cell.get("r", "")) in selected:
                        index = shared_string_index(cell)
                        if index is not None:
                            required_indices.add(index)
        data_strings = (
            load_shared_strings(archive, strings_path, required_indices)
            if has_shared_strings
            else {}
        )
        shared_strings = {**header_strings, **data_strings}

        result: dict[str, list[dict[str, str]]] = {}
        for sheet_name, _ in sheet_files:
            xml_rows = rows_by_sheet[sheet_name]
            if not xml_rows:
                result[sheet_name] = []
                continue
            if (
                not include_nonpassword_fields
                and sheet_name not in IMPORTABLE_SHEETS
                and sheet_name not in {USER_SHEET, "PERFIL"}
            ):
                result[sheet_name] = [
                    {} for row in xml_rows[1:]
                    if any(cell.find("m:v", NS) is not None or cell.get("t") == "inlineStr"
                           for cell in row.findall("m:c", NS))
                ]
                continue
            headers = headers_by_sheet[sheet_name]
            selected = selected_columns[sheet_name]
            rows = []
            for xml_row in xml_rows[1:]:
                row = {
                    headers[column_name(cell.get("r", ""))]: cell_text(cell, shared_strings)
                    for cell in xml_row.findall("m:c", NS)
                    if column_name(cell.get("r", "")) in selected
                    and column_name(cell.get("r", "")) in headers
                }
                nonempty_cells = any(
                    cell.find("m:v", NS) is not None
                    or (cell.get("t") == "inlineStr" and cell.find(".//m:t", NS) is not None)
                    for cell in xml_row.findall("m:c", NS)
                )
                if any(row.values()) or (sheet_name == USER_SHEET and nonempty_cells):
                    rows.append(row)
            result[sheet_name] = rows
        return result


def normalized_cnpj(value: str) -> str:
    return re.sub(r"\D", "", value)


def parse_active(value: str, default: int = 1) -> int:
    normalized = value.strip().casefold()
    if not normalized:
        return default
    if normalized in {"1", "true", "sim", "ativo", "ativa", "yes"}:
        return 1
    if normalized in {"0", "false", "não", "nao", "inativo", "inativa", "no"}:
        return 0
    raise ValueError("invalid active flag")


def stable_id(source_name: str, sheet_name: str, source_id: str) -> str:
    return str(uuid.uuid5(NAMESPACE, f"{source_name.casefold()}:{sheet_name}:{source_id}"))


def source_counts(
    sheets: dict[str, list[dict[str, str]]],
) -> dict[str, Counter[str]]:
    counts: dict[str, Counter[str]] = {}
    for sheet_name, rows in sheets.items():
        if sheet_name == USER_SHEET:
            counts[sheet_name] = Counter({"skipped_users_excluded": len(rows)})
        elif sheet_name == "PERFIL":
            counts[sheet_name] = Counter()
        elif sheet_name not in IMPORTABLE_SHEETS:
            counts[sheet_name] = Counter({"skipped_unmapped_or_dependent": len(rows)})
        else:
            counts[sheet_name] = Counter()
    return counts


def safe_database_path(path_arg: str | None) -> Path:
    configured = path_arg or os.environ.get("DATABASE_PATH")
    if not configured:
        env_file = ROOT / ".env"
        if env_file.is_file():
            for line in env_file.read_text(encoding="utf-8").splitlines():
                if line.strip().startswith("DATABASE_PATH="):
                    configured = line.split("=", 1)[1].strip().strip("\"'")
                    break
    configured = configured or "data/qiconect.sqlite"
    if configured == ":memory:":
        raise ValueError("DATABASE_PATH is in-memory; specify a persistent SQLite file.")
    database_path = Path(configured)
    if not database_path.is_absolute():
        database_path = ROOT / database_path
    return database_path.resolve()


def open_database(path: Path, read_only: bool) -> sqlite3.Connection:
    if not path.is_file():
        raise FileNotFoundError(f"Database not found: {path}")
    uri = path.as_uri() + ("?mode=ro" if read_only else "")
    connection = sqlite3.connect(uri, uri=True, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 10000")
    return connection


def validate_schema(connection: sqlite3.Connection, apply: bool) -> None:
    tables = {
        row["name"]
        for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    }
    if "schema_migrations" not in tables:
        raise RuntimeError("QIConect schema_migrations table is missing.")
    applied = {
        row["version"]
        for row in connection.execute("SELECT version FROM schema_migrations")
    }
    if "0001_workbook_clinical_domain.sql" not in applied:
        raise RuntimeError("Apply the QIConect database migrations before importing.")
    migrations_directory = ROOT / "apps" / "api" / "src" / "db" / "migrations"
    pending = [
        path
        for path in sorted(migrations_directory.glob("*.sql"))
        if path.name not in applied
    ]
    if pending and not apply:
        raise RuntimeError("Apply pending QIConect database migrations before importing.")

    for migration_path in pending:
        statements = []
        current = ""
        for line in migration_path.read_text(encoding="utf-8").splitlines():
            current += line + "\n"
            if sqlite3.complete_statement(current):
                statements.append(current.strip())
                current = ""
        if current.strip():
            raise RuntimeError(f"Incomplete SQL migration: {migration_path.name}")
        connection.execute("BEGIN IMMEDIATE")
        try:
            for statement in statements:
                connection.execute(statement)
            connection.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
                (migration_path.name, datetime.now(timezone.utc).isoformat()),
            )
            connection.commit()
        except Exception:
            connection.rollback()
            raise


def required_text(row: dict[str, str], key: str) -> str:
    value = row.get(key, "").strip()
    if not value:
        raise ValueError(f"missing {key}")
    return value


def find_existing_clinic(
    connection: sqlite3.Connection, cnpj: str
) -> str | None:
    if not cnpj:
        return None
    for row in connection.execute("SELECT id, cnpj FROM CLINICA WHERE cnpj IS NOT NULL"):
        if normalized_cnpj(row["cnpj"]) == cnpj:
            return row["id"]
    return None


def insert_or_reuse_clinic(
    connection: sqlite3.Connection,
    source_name: str,
    row: dict[str, str],
    counts: Counter[str],
) -> str | None:
    try:
        source_id = required_text(row, "id")
        name = required_text(row, "nome")
        cnpj_value = normalized_cnpj(row.get("cnpj", ""))
        if cnpj_value and len(cnpj_value) != 14:
            raise ValueError("invalid cnpj")
        active = parse_active(row.get("ativo", "1"))
    except ValueError:
        counts["skipped_invalid"] += 1
        return None

    existing_id = find_existing_clinic(connection, cnpj_value)
    if existing_id:
        counts["reused"] += 1
        return existing_id

    target_id = stable_id(source_name, "CLINICA", source_id)
    existing = connection.execute(
        "SELECT id FROM CLINICA WHERE id = ?", (target_id,)
    ).fetchone()
    if existing:
        raise RuntimeError("Generated clinic identifier already exists; import stopped.")

    slug = "workbook-" + target_id.replace("-", "")[:24]
    now = datetime.now(timezone.utc).isoformat()
    connection.execute(
        """
        INSERT INTO CLINICA (id, slug, nome, timezone, dt_registro, cnpj, email, telefone, endereco, ativo, dt_atualizacao)
        VALUES (?, ?, ?, 'America/Sao_Paulo', ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            target_id,
            slug,
            name,
            now,
            cnpj_value or None,
            row.get("email", "").strip() or None,
            row.get("telefone", "").strip() or None,
            row.get("endereco", "").strip() or None,
            active,
            now,
        ),
    )
    counts["imported"] += 1
    return target_id


def process_profiles(
    connection: sqlite3.Connection,
    rows: list[dict[str, str]],
    counts: Counter[str],
) -> None:
    known_names = {
        row["nome"].strip().casefold()
        for row in connection.execute("SELECT nome FROM PERFIL")
    }
    for row in rows:
        name = row.get("nome", "").strip().casefold()
        if name in PROFILE_NAMES and name in known_names:
            counts["reused"] += 1
        else:
            counts["skipped_unmapped_profile"] += 1


def import_catalogs(
    connection: sqlite3.Connection,
    source_name: str,
    clinic_id: str,
    sheets: dict[str, list[dict[str, str]]],
    counts: dict[str, Counter[str]],
) -> None:
    specialty_ids: dict[str, str] = {}
    seen_specialty_ids: set[str] = set()
    specialty_rows = sheets.get("ESPECIALIDADE", [])
    for row in specialty_rows:
        source_id = row.get("id", "").strip()
        try:
            if not source_id:
                raise ValueError("missing id")
            if source_id in seen_specialty_ids:
                raise ValueError("duplicate id")
            seen_specialty_ids.add(source_id)
            name = required_text(row, "nome")
            active = parse_active(row.get("ativo", "1"))
        except ValueError:
            counts["ESPECIALIDADE"]["skipped_invalid"] += 1
            continue

        existing = connection.execute(
            "SELECT id FROM ESPECIALIDADE WHERE clinic_id = ? AND nome = ? COLLATE NOCASE",
            (clinic_id, name),
        ).fetchone()
        if existing:
            specialty_ids[source_id] = existing["id"]
            counts["ESPECIALIDADE"]["reused"] += 1
            continue

        target_id = stable_id(source_name, "ESPECIALIDADE", source_id)
        if connection.execute("SELECT 1 FROM ESPECIALIDADE WHERE id = ?", (target_id,)).fetchone():
            raise RuntimeError("Generated specialty identifier already exists; import stopped.")
        connection.execute(
            "INSERT INTO ESPECIALIDADE (id, clinic_id, nome, descricao, ativo) VALUES (?, ?, ?, ?, ?)",
            (target_id, clinic_id, name, row.get("descricao", "").strip() or None, active),
        )
        specialty_ids[source_id] = target_id
        counts["ESPECIALIDADE"]["imported"] += 1

    seen_therapy_ids: set[str] = set()
    for row in sheets.get("TERAPIA", []):
        source_id = row.get("id", "").strip()
        try:
            if not source_id:
                raise ValueError("missing id")
            if source_id in seen_therapy_ids:
                raise ValueError("duplicate id")
            seen_therapy_ids.add(source_id)
            name = required_text(row, "nome")
            source_specialty_id = required_text(row, "especialidade_id")
            specialty_id = specialty_ids.get(source_specialty_id)
            if not specialty_id:
                raise ValueError("unresolved specialty")
            duration_value = float(required_text(row, "duracao_min"))
            if not duration_value.is_integer():
                raise ValueError("invalid duration")
            duration = int(duration_value)
            if not 10 <= duration <= 480:
                raise ValueError("invalid duration")
            active = parse_active(row.get("ativa", "1"))
        except ValueError:
            counts["TERAPIA"]["skipped_invalid_or_dependency"] += 1
            continue

        existing = connection.execute(
            "SELECT id, especialidade_id FROM TERAPIA WHERE clinic_id = ? AND nome = ? COLLATE NOCASE",
            (clinic_id, name),
        ).fetchone()
        if existing:
            counts["TERAPIA"][
                "reused" if existing["especialidade_id"] == specialty_id else "skipped_conflict"
            ] += 1
            continue

        target_id = stable_id(source_name, "TERAPIA", source_id)
        if connection.execute("SELECT 1 FROM TERAPIA WHERE id = ?", (target_id,)).fetchone():
            raise RuntimeError("Generated therapy identifier already exists; import stopped.")
        connection.execute(
            """
            INSERT INTO TERAPIA (
              id, clinic_id, especialidade_id, nome, descricao, duracao_min, price, ativa
            ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
            """,
            (
                target_id,
                clinic_id,
                specialty_id,
                name,
                row.get("descricao", "").strip() or None,
                duration,
                active,
            ),
        )
        counts["TERAPIA"]["imported"] += 1

    seen_questions: set[str] = set()
    seen_question_ids: set[str] = set()
    for index, row in enumerate(sheets.get("PERGUNTAS", []), start=1):
        source_id = row.get("id", "").strip()
        try:
            if not source_id:
                raise ValueError("missing id")
            if source_id in seen_question_ids:
                raise ValueError("duplicate id")
            seen_question_ids.add(source_id)
            description = required_text(row, "descricao")
        except ValueError:
            counts["PERGUNTAS"]["skipped_invalid"] += 1
            continue

        if description in seen_questions:
            counts["PERGUNTAS"]["skipped_duplicate"] += 1
            continue
        seen_questions.add(description)
        existing = connection.execute(
            """
            SELECT id FROM PERGUNTAS
            WHERE clinic_id = ? AND specialty_id IS NULL AND descricao = ? COLLATE NOCASE
            """,
            (clinic_id, description),
        ).fetchone()
        if existing:
            counts["PERGUNTAS"]["reused"] += 1
            continue

        target_id = stable_id(source_name, "PERGUNTAS", source_id)
        if connection.execute(
            "SELECT 1 FROM PERGUNTAS WHERE id = ?", (target_id,)
        ).fetchone():
            raise RuntimeError("Generated question identifier already exists; import stopped.")
        connection.execute(
            """
            INSERT INTO PERGUNTAS (id, clinic_id, specialty_id, descricao, ativo, display_order)
            VALUES (?, ?, NULL, ?, 1, ?)
            """,
            (target_id, clinic_id, description, index),
        )
        counts["PERGUNTAS"]["imported"] += 1


def summarize(
    counts: dict[str, Counter[str]], batch: dict[str, Any] | None = None
) -> dict[str, Any]:
    totals: Counter[str] = Counter()
    for sheet_counts in counts.values():
        totals.update(sheet_counts)
    result: dict[str, Any] = {
        "source_rows": (
            totals["imported"] + totals["reused"] + totals["would_import"] + sum(
            count
            for key, count in totals.items()
            if key.startswith("skipped_")
            )
        ),
        "imported": totals["imported"],
        "reused": totals["reused"],
        "would_import": totals["would_import"],
        "skipped": sum(
            count
            for key, count in totals.items()
            if key.startswith("skipped_")
        ),
        "tables": {
            sheet: dict(sheet_counts)
            for sheet, sheet_counts in counts.items()
        },
        "users_imported": 0,
        "clinical_rows_imported": 0,
    }
    if batch is not None:
        result["batch"] = batch
    return result


def preview(
    connection: sqlite3.Connection,
    source_name: str,
    source_hash: str,
    sheets: dict[str, list[dict[str, str]]],
) -> dict[str, Any]:
    counts = source_counts(sheets)
    clinic_id = None
    clinic_rows = sheets.get("CLINICA", [])
    if len(clinic_rows) == 1:
        try:
            required_text(clinic_rows[0], "id")
            required_text(clinic_rows[0], "nome")
            parse_active(clinic_rows[0].get("ativo", "1"))
            cnpj = normalized_cnpj(clinic_rows[0].get("cnpj", ""))
            if cnpj and len(cnpj) != 14:
                counts["CLINICA"]["skipped_invalid"] += 1
            else:
                existing = find_existing_clinic(connection, cnpj)
                if existing:
                    clinic_id = existing
                    counts["CLINICA"]["reused"] += 1
                else:
                    clinic_id = stable_id(source_name, "CLINICA", clinic_rows[0]["id"])
                    counts["CLINICA"]["imported"] += 1
        except (sqlite3.Error, ValueError):
            counts["CLINICA"]["skipped_invalid"] += 1
    else:
        counts.setdefault("CLINICA", Counter())["skipped_invalid"] += len(clinic_rows) or 1

    profile_rows = sheets.get("PERFIL", [])
    profile_counts = counts.setdefault("PERFIL", Counter())
    known_names = {
        row["nome"].strip().casefold()
        for row in connection.execute("SELECT nome FROM PERFIL")
    }
    for row in profile_rows:
        name = row.get("nome", "").strip().casefold()
        if name in PROFILE_NAMES and name in known_names:
            profile_counts["reused"] += 1
        else:
            profile_counts["skipped_unmapped_profile"] += 1

    if clinic_id:
        specialty_map: dict[str, str] = {}
        for row in sheets.get("ESPECIALIDADE", []):
            try:
                source_id = required_text(row, "id")
                name = required_text(row, "nome")
                parse_active(row.get("ativo", "1"))
            except ValueError:
                counts["ESPECIALIDADE"]["skipped_invalid"] += 1
                continue
            existing = connection.execute(
                "SELECT id FROM ESPECIALIDADE WHERE clinic_id = ? AND nome = ? COLLATE NOCASE",
                (clinic_id, name),
            ).fetchone()
            if existing:
                specialty_map[source_id] = existing["id"]
                counts["ESPECIALIDADE"]["reused"] += 1
            else:
                specialty_map[source_id] = stable_id(
                    source_name, "ESPECIALIDADE", source_id
                )
                counts["ESPECIALIDADE"]["would_import"] += 1

        for row in sheets.get("TERAPIA", []):
            try:
                source_id = required_text(row, "id")
                name = required_text(row, "nome")
                specialty_id = specialty_map.get(required_text(row, "especialidade_id"))
                duration_value = float(required_text(row, "duracao_min"))
                if not duration_value.is_integer():
                    raise ValueError("invalid duration")
                duration = int(duration_value)
                parse_active(row.get("ativa", "1"))
                if not specialty_id or not 10 <= duration <= 480:
                    raise ValueError("invalid or unresolved dependency")
            except ValueError:
                counts["TERAPIA"]["skipped_invalid_or_dependency"] += 1
                continue
            existing = connection.execute(
                "SELECT id, especialidade_id FROM TERAPIA WHERE clinic_id = ? AND nome = ? COLLATE NOCASE",
                (clinic_id, name),
            ).fetchone()
            if existing:
                counts["TERAPIA"][
                    "reused" if existing["especialidade_id"] == specialty_id else "skipped_conflict"
                ] += 1
            else:
                counts["TERAPIA"]["would_import"] += 1

        seen_questions: set[str] = set()
        for row in sheets.get("PERGUNTAS", []):
            try:
                required_text(row, "id")
                description = required_text(row, "descricao")
            except ValueError:
                counts["PERGUNTAS"]["skipped_invalid"] += 1
                continue
            if description in seen_questions:
                counts["PERGUNTAS"]["skipped_duplicate"] += 1
                continue
            seen_questions.add(description)
            existing = connection.execute(
                """
                SELECT id FROM PERGUNTAS
                WHERE clinic_id = ? AND specialty_id IS NULL AND descricao = ? COLLATE NOCASE
                """,
                (clinic_id, description),
            ).fetchone()
            if existing:
                counts["PERGUNTAS"]["reused"] += 1
            else:
                counts["PERGUNTAS"]["would_import"] += 1

    report = summarize(counts)
    report["mode"] = "preview; no database writes"
    report["source"] = source_name
    report["source_sha256"] = source_hash
    report["clinic_identity"] = "matched by CNPJ" if counts["CLINICA"]["reused"] else "new isolated clinic"
    return report


def backup_database(database_path: Path) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = database_path.with_name(
        f"{database_path.stem}.before-import-{timestamp}{database_path.suffix}"
    )
    counter = 1
    while backup_path.exists():
        backup_path = database_path.with_name(
            f"{database_path.stem}.before-import-{timestamp}-{counter}{database_path.suffix}"
        )
        counter += 1

    source = sqlite3.connect(database_path)
    destination = sqlite3.connect(backup_path)
    try:
        source.backup(destination)
    finally:
        destination.close()
        source.close()
    return backup_path


def apply_import(
    database_path: Path,
    source_name: str,
    source_hash: str,
    sheets: dict[str, list[dict[str, str]]],
) -> dict[str, Any]:
    connection = open_database(database_path, read_only=False)
    backup_path: Path | None = None
    try:
        migrations = {
            row["version"]
            for row in connection.execute("SELECT version FROM schema_migrations")
        }
        if MIGRATION_FILE in migrations:
            existing_batch = connection.execute(
                """
                SELECT summary_json FROM workbook_import_batches
                WHERE source_name = ? AND source_sha256 = ?
                """,
                (source_name, source_hash),
            ).fetchone()
            if existing_batch:
                report = json.loads(existing_batch["summary_json"])
                report["mode"] = "already imported; no database writes"
                return report

        backup_path = backup_database(database_path)
        validate_schema(connection, apply=True)
        connection.execute("BEGIN IMMEDIATE")
        counts = source_counts(sheets)

        clinic_rows = sheets.get("CLINICA", [])
        if len(clinic_rows) != 1:
            counts.setdefault("CLINICA", Counter())["skipped_invalid"] += len(clinic_rows) or 1
            clinic_id = None
        else:
            clinic_id = insert_or_reuse_clinic(
                connection, source_name, clinic_rows[0], counts.setdefault("CLINICA", Counter())
            )

        process_profiles(connection, sheets.get("PERFIL", []), counts.setdefault("PERFIL", Counter()))
        if clinic_id:
            import_catalogs(connection, source_name, clinic_id, sheets, counts)
        else:
            for sheet_name in ("ESPECIALIDADE", "TERAPIA", "PERGUNTAS"):
                counts.setdefault(sheet_name, Counter())["skipped_clinic_unavailable"] += len(
                    sheets.get(sheet_name, [])
                )

        report = summarize(counts)
        report["mode"] = "imported"
        report["source"] = source_name
        report["source_sha256"] = source_hash
        report["clinic_identity"] = "matched by CNPJ" if counts["CLINICA"]["reused"] else "new isolated clinic"
        report["backup"] = str(backup_path)
        batch_id = str(uuid.uuid4())
        report["batch"] = batch_id
        now = datetime.now(timezone.utc).isoformat()
        imported = report["imported"]
        reused = report["reused"]
        skipped = report["skipped"]
        connection.execute(
            """
            INSERT INTO workbook_import_batches (
              id, source_name, source_sha256, clinic_id, imported_at,
              imported_rows, reused_rows, skipped_rows, summary_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                batch_id,
                source_name,
                source_hash,
                clinic_id,
                now,
                imported,
                reused,
                skipped,
                json.dumps(report, ensure_ascii=False, sort_keys=True),
            ),
        )

        violations = connection.execute("PRAGMA foreign_key_check").fetchall()
        if violations:
            raise RuntimeError("Foreign-key validation failed after import.")
        connection.commit()
        report["batch"] = batch_id
        return report
    except Exception:
        connection.rollback()
        if backup_path:
            print(f"Import rolled back; backup retained at {backup_path}", file=sys.stderr)
        raise
    finally:
        connection.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="Path to the .xlsx workbook")
    parser.add_argument("--database", help="SQLite database path (defaults to DATABASE_PATH or data/qiconect.sqlite)")
    parser.add_argument("--apply", action="store_true", help="Write the safe import in one transaction")
    args = parser.parse_args()
    workbook_path = args.input.resolve()
    if not workbook_path.is_file():
        parser.error(f"Workbook not found: {workbook_path}")

    try:
        source_hash = hashlib.sha256(workbook_path.read_bytes()).hexdigest()
        source_name = workbook_path.name
        sheets = read_workbook(workbook_path)
        database_path = safe_database_path(args.database)

        if not args.apply:
            connection = open_database(database_path, read_only=True)
            try:
                validate_schema(connection, apply=False)
                report = preview(connection, source_name, source_hash, sheets)
            finally:
                connection.close()
        else:
            report = apply_import(
                database_path, source_name, source_hash, sheets
            )
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    except (OSError, sqlite3.Error, zipfile.BadZipFile, ET.ParseError, RuntimeError, ValueError) as error:
        print(f"Import failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
