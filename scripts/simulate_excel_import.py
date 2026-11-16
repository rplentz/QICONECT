#!/usr/bin/env python3
"""Dry-run workbook relationship checks. This script never writes to the app database."""

from __future__ import annotations

import argparse
from io import BytesIO
import json
import posixpath
import sys
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET


MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
DOC_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = {"m": MAIN_NS, "r": DOC_REL_NS, "p": PKG_REL_NS}

FOREIGN_KEYS: dict[str, list[tuple[str, str, bool]]] = {
    "PACIENTE": [("usuario_id", "USUARIO", False), ("clinica_id", "CLINICA", False)],
    "TERAPEUTA": [("usuario_id", "USUARIO", False), ("clinica_id", "CLINICA", False)],
    "TERAPEUTA_ESPECIALIDADE": [
        ("terapeuta_id", "TERAPEUTA", False),
        ("especialidade_id", "ESPECIALIDADE", False),
    ],
    "TERAPIA": [("especialidade_id", "ESPECIALIDADE", False)],
    "PROTOCOLO": [
        ("terapia_id", "TERAPIA", False),
        ("terapeuta_id", "TERAPEUTA", True),
        ("diagnostico_id", "DIAGNOSTICO", True),
    ],
    "PROTOCOLO_ETAPA": [("protocolo_id", "PROTOCOLO", False)],
    "DIAGNOSTICO": [
        ("terapeuta_id", "TERAPEUTA", False),
        ("paciente_id", "PACIENTE", False),
    ],
    "DIAGNOSTICO_PROTOCOLO": [
        ("diagnostico_id", "DIAGNOSTICO", False),
        ("protocolo_etapa_id", "PROTOCOLO_ETAPA", False),
    ],
    "EVOLUCAO": [("diagnostico_protocolo_id", "DIAGNOSTICO_PROTOCOLO", False)],
    "AGENDA": [
        ("paciente_id", "PACIENTE", False),
        ("terapeuta_id", "TERAPEUTA", False),
        ("terapia_id", "TERAPIA", False),
    ],
    "ATENDIMENTO": [
        ("prontuario_id", "PRONTUARIO", False),
        ("paciente_id", "PACIENTE", False),
        ("terapeuta_id", "TERAPEUTA", False),
        ("terapia_id", "TERAPIA", False),
    ],
    "PRONTUARIO": [("paciente_id", "PACIENTE", False)],
    "ANAMNESE": [("atendimento_id", "ATENDIMENTO", False)],
    "ANAMNESE_PERGUNTAS": [
        ("anamnese_id", "ANAMNESE", False),
        ("pergunta_id", "PERGUNTAS", False),
    ],
    "ANEXO": [
        ("prontuario_id", "PRONTUARIO", False),
        ("atendimento_id", "ATENDIMENTO", True),
    ],
    "BIOWELL_AVALIACAO": [
        ("paciente_id", "PACIENTE", False),
        ("atendimento_id", "ATENDIMENTO", True),
    ],
    "BIOWELL_CHAKRA": [("avaliacao_id", "BIOWELL_AVALIACAO", False)],
    "ANALISE_LINGUA": [
        ("paciente_id", "PACIENTE", False),
        ("atendimento_id", "ATENDIMENTO", True),
    ],
    "RELATORIO": [
        ("paciente_id", "PACIENTE", False),
        ("atendimento_id", "ATENDIMENTO", True),
    ],
    "PAGAMENTO": [
        ("paciente_id", "PACIENTE", False),
        ("agenda_id", "AGENDA", True),
    ],
    "PACOTE": [("paciente_id", "PACIENTE", False)],
    "AUDITORIA": [("usuario_id", "USUARIO", True)],
}

KEY_COLUMNS = {
    "id",
    "usuario_id",
    "clinica_id",
    "terapeuta_id",
    "especialidade_id",
    "terapia_id",
    "diagnostico_id",
    "protocolo_id",
    "protocolo_etapa_id",
    "paciente_id",
    "prontuario_id",
    "atendimento_id",
    "pergunta_id",
    "anamnese_id",
    "anamnese_perguntas_id",
    "diagnostico_protocolo_id",
    "avaliacao_id",
    "agenda_id",
    "registro_id",
}

EXCLUDED_SHEETS: set[str] = set()
STRUCTURAL_BLOCKERS: dict[str, str] = {}


def column_name(cell_reference: str) -> str:
    return "".join(character for character in cell_reference if character.isalpha()).upper()


def shared_string_indices(xml_bytes: bytes, sheet_name: str) -> set[int]:
    root = ET.fromstring(xml_bytes)
    needed: set[int] = set()
    for row in root.findall(".//m:sheetData/m:row", NS):
        for cell in row.findall("m:c", NS):
            col = column_name(cell.get("r", ""))
            if sheet_name == "USUARIO" and row.get("r") != "1" and col != "A":
                continue
            value = cell.find("m:v", NS)
            if cell.get("t") == "s" and value is not None:
                try:
                    needed.add(int(value.text or ""))
                except ValueError:
                    continue
    return needed


def load_shared_strings(xml_bytes: bytes, required_indices: set[int]) -> list[str]:
    values: list[str] = []
    index = 0
    for _, element in ET.iterparse(BytesIO(xml_bytes), events=("end",)):
        if element.tag != f"{{{MAIN_NS}}}si":
            continue
        if index in required_indices:
            values.append(
                "".join(text.text or "" for text in element.findall(".//m:t", NS))
            )
        else:
            values.append("")
        index += 1
        element.clear()
    return values


def workbook_sheets(archive: zipfile.ZipFile) -> list[tuple[str, str]]:
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    targets = {item.get("Id"): item.get("Target") for item in relationships}
    sheets: list[tuple[str, str]] = []
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


def read_sheet_rows(
    archive: zipfile.ZipFile,
    sheet_name: str,
    sheet_path: str,
    shared_strings: list[str],
) -> tuple[list[str], list[dict[str, str]]]:
    root = ET.fromstring(archive.read(sheet_path))
    xml_rows = root.findall(".//m:sheetData/m:row", NS)
    if not xml_rows:
        return [], []

    headers: dict[str, str] = {}
    for cell in xml_rows[0].findall("m:c", NS):
        reference = cell.get("r", "")
        value = cell.find("m:v", NS)
        text = ""
        if cell.get("t") == "s" and value is not None:
            string_index = int(value.text or "0")
            text = shared_strings[string_index] if string_index < len(shared_strings) else ""
        elif value is not None:
            text = value.text or ""
        elif cell.get("t") == "inlineStr":
            text = "".join(part.text or "" for part in cell.findall(".//m:t", NS))
        headers[column_name(reference)] = text.strip().lower()

    selected_columns = {
        column for column, header in headers.items() if header in KEY_COLUMNS
    }
    if sheet_name == "PERFIL":
        selected_columns.update(
            column for column, header in headers.items() if header == "nome"
        )

    rows: list[dict[str, str]] = []
    for row in xml_rows[1:]:
        record: dict[str, str] = {}
        for cell in row.findall("m:c", NS):
            reference = cell.get("r", "")
            column = column_name(reference)
            if column not in selected_columns:
                continue
            header = headers.get(column)
            if not header:
                continue
            value = cell.find("m:v", NS)
            if cell.get("t") == "s" and value is not None:
                index = int(value.text or "0")
                text = shared_strings[index] if index < len(shared_strings) else ""
            elif value is not None:
                text = value.text or ""
            elif cell.get("t") == "inlineStr":
                text = "".join(part.text or "" for part in cell.findall(".//m:t", NS))
            else:
                text = ""
            if text:
                record[header] = text.strip()
        if any(value for value in record.values()):
            rows.append(record)
    return list(headers.values()), rows


def simulate(workbook_path: Path) -> dict[str, Any]:
    with zipfile.ZipFile(workbook_path) as archive:
        sheet_files = workbook_sheets(archive)
        sheet_xml = {name: archive.read(path) for name, path in sheet_files}
        required_indices: set[int] = set()
        for name, _ in sheet_files:
            required_indices.update(shared_string_indices(sheet_xml[name], name))

        strings_path = "xl/sharedStrings.xml"
        strings = (
            load_shared_strings(archive.read(strings_path), required_indices)
            if strings_path in archive.namelist()
            else []
        )

        sheets: dict[str, dict[str, Any]] = {}
        for name, path in sheet_files:
            headers, rows = read_sheet_rows(archive, name, path, strings)
            sheets[name] = {"headers": headers, "rows": rows}

    ids_by_sheet: dict[str, set[str]] = {}
    for name, sheet in sheets.items():
        ids_by_sheet[name] = {
            row["id"] for row in sheet["rows"] if row.get("id")
        }

    blocked_ids: dict[str, set[str]] = defaultdict(set)
    invalid_ids: dict[str, set[str]] = defaultdict(set)
    statuses: dict[str, list[str]] = {
        name: ["blocked"] * len(sheets[name]["rows"])
        for name in STRUCTURAL_BLOCKERS
        if name in sheets
    }
    reference_issues: dict[str, set[tuple[int, str]]] = defaultdict(set)

    for name in EXCLUDED_SHEETS:
        blocked_ids[name].update(ids_by_sheet.get(name, set()))
    for name in STRUCTURAL_BLOCKERS:
        blocked_ids[name].update(ids_by_sheet.get(name, set()))

    changed = True
    while changed:
        changed = False
        for name, sheet in sheets.items():
            if name in EXCLUDED_SHEETS or name in STRUCTURAL_BLOCKERS:
                continue
            foreign_keys = FOREIGN_KEYS.get(name, [])
            row_statuses: list[str] = []
            for row_index, row in enumerate(sheet["rows"]):
                row_id = row.get("id", "")
                if not row_id:
                    row_statuses.append("invalid")
                    reference_issues[name].add((row_index, "id"))
                    continue

                row_blocked = False
                row_invalid = False
                for field, referenced_sheet, optional in foreign_keys:
                    value = row.get(field, "")
                    if not value:
                        if optional:
                            continue
                        row_invalid = True
                        reference_issues[name].add((row_index, field))
                        continue
                    if value in blocked_ids[referenced_sheet] or value in invalid_ids[referenced_sheet]:
                        row_blocked = True
                    elif value not in ids_by_sheet.get(referenced_sheet, set()):
                        row_invalid = True
                        reference_issues[name].add((row_index, field))

                if row_invalid:
                    row_statuses.append("invalid")
                    if row_id and row_id not in invalid_ids[name]:
                        invalid_ids[name].add(row_id)
                        blocked_ids[name].add(row_id)
                        changed = True
                elif row_blocked:
                    row_statuses.append("blocked")
                    if row_id and row_id not in blocked_ids[name]:
                        blocked_ids[name].add(row_id)
                        changed = True
                else:
                    row_statuses.append("ready")
            statuses[name] = row_statuses

    result_sheets = []
    totals = {"rows": 0, "ready": 0, "blocked": 0, "invalid": 0, "excluded": 0}
    for name, sheet in sheets.items():
        row_count = len(sheet["rows"])
        if name in EXCLUDED_SHEETS:
            counts = {"ready": 0, "blocked": 0, "invalid": 0, "excluded": row_count}
        elif name in STRUCTURAL_BLOCKERS:
            counts = {"ready": 0, "blocked": row_count, "invalid": 0, "excluded": 0}
        else:
            row_statuses = statuses.get(name, [])
            counts = {
                status: row_statuses.count(status)
                for status in ("ready", "blocked", "invalid")
            }
            counts["excluded"] = 0

        totals["rows"] += row_count
        for status in ("ready", "blocked", "invalid", "excluded"):
            totals[status] += counts[status]

        result_sheets.append(
            {
                "sheet": name,
                "rows": row_count,
                **counts,
                "missing_or_unresolved_references": len(reference_issues.get(name, set())),
                "note": (
                    "Usuários excluídos conforme opção escolhida."
                    if name in EXCLUDED_SHEETS
                    else STRUCTURAL_BLOCKERS.get(name)
                ),
            }
        )

    unresolved = [
        item
        for item in result_sheets
        if item["blocked"] or item["invalid"] or item["excluded"]
    ]
    return {
        "workbook": workbook_path.name,
        "mode": "dry-run; no database writes",
        "sensitive_values": "not included in report; user account fields other than IDs are skipped",
        "summary": {
            **totals,
            "tables": len(result_sheets),
            "tables_with_blockers": len(unresolved),
        },
        "tables": result_sheets,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="Path to the .xlsx workbook")
    args = parser.parse_args()
    if not args.input.is_file():
        parser.error(f"Workbook not found: {args.input}")

    try:
        report = simulate(args.input)
    except (OSError, zipfile.BadZipFile, ET.ParseError, KeyError) as error:
        print(f"Unable to inspect workbook structure: {type(error).__name__}", file=sys.stderr)
        return 1

    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
