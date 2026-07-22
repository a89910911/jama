"""Build the two JamaAI user manuals as dependency-free DOCX files.

The Markdown files remain the editable source of truth.  This small converter
supports the subset used by the manuals: headings, paragraphs, block quotes,
bullets, numbered/check lists, tables, inline emphasis/code and PNG/JPEG images.
"""

from __future__ import annotations

import datetime as dt
import html
import re
import struct
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent
MANUALS = [
    ROOT / "JamaAI-功能说明-编剧编导版.md",
    ROOT / "JamaAI-操作说明书-编剧编导版.md",
]

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def esc(value: str) -> str:
    return html.escape(value, quote=False)


def clean_markdown(value: str) -> str:
    value = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1（\2）", value)
    value = value.replace("**", "").replace("__", "")
    value = value.replace("`", "")
    return value.strip()


def inline_runs(value: str, *, force_bold: bool = False, italic: bool = False) -> str:
    value = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1（\2）", value)
    token_re = re.compile(r"(\*\*.+?\*\*|`.+?`)")
    parts = token_re.split(value)
    runs: list[str] = []
    for part in parts:
        if not part:
            continue
        bold = force_bold
        code = False
        text = part
        if part.startswith("**") and part.endswith("**"):
            bold = True
            text = part[2:-2]
        elif part.startswith("`") and part.endswith("`"):
            code = True
            text = part[1:-1]
        rpr: list[str] = []
        if bold:
            rpr.append("<w:b/>")
        if italic:
            rpr.append("<w:i/>")
        if code:
            rpr.append('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Microsoft YaHei"/>')
            rpr.append('<w:shd w:fill="F3F4F6"/>')
        rpr_xml = f"<w:rPr>{''.join(rpr)}</w:rPr>" if rpr else ""
        lines = text.split("\n")
        body: list[str] = []
        for idx, line in enumerate(lines):
            if idx:
                body.append("<w:br/>")
            body.append(f'<w:t xml:space="preserve">{esc(line)}</w:t>')
        runs.append(f"<w:r>{rpr_xml}{''.join(body)}</w:r>")
    return "".join(runs)


def paragraph(
    value: str,
    style: str = "Normal",
    *,
    align: str | None = None,
    before: int | None = None,
    after: int | None = None,
    indent: int | None = None,
    force_bold: bool = False,
    italic: bool = False,
) -> str:
    ppr = [f'<w:pStyle w:val="{style}"/>'] if style else []
    if align:
        ppr.append(f'<w:jc w:val="{align}"/>')
    if before is not None or after is not None:
        attrs = []
        if before is not None:
            attrs.append(f'w:before="{before}"')
        if after is not None:
            attrs.append(f'w:after="{after}"')
        ppr.append(f"<w:spacing {' '.join(attrs)}/>")
    if indent is not None:
        ppr.append(f'<w:ind w:left="{indent}"/>')
    return f"<w:p><w:pPr>{''.join(ppr)}</w:pPr>{inline_runs(value, force_bold=force_bold, italic=italic)}</w:p>"


def png_size(path: Path) -> tuple[int, int]:
    data = path.read_bytes()[:32]
    if data.startswith(b"\x89PNG"):
        return struct.unpack(">II", data[16:24])
    # JPEG: find a Start Of Frame marker.
    data = path.read_bytes()
    idx = 2
    while idx + 9 < len(data):
        if data[idx] != 0xFF:
            idx += 1
            continue
        marker = data[idx + 1]
        idx += 2
        if marker in (0xD8, 0xD9):
            continue
        length = int.from_bytes(data[idx:idx + 2], "big")
        if marker in range(0xC0, 0xC4):
            height = int.from_bytes(data[idx + 3:idx + 5], "big")
            width = int.from_bytes(data[idx + 5:idx + 7], "big")
            return width, height
        idx += max(length, 2)
    return 1280, 720


def drawing(rid: str, image_id: int, path: Path, alt: str) -> str:
    width, height = png_size(path)
    max_w, max_h = 6.35, 4.55
    scale = min(max_w * 96 / width, max_h * 96 / height)
    cx = int(width * scale / 96 * 914400)
    cy = int(height * scale / 96 * 914400)
    return f"""
<w:p>
  <w:pPr><w:jc w:val="center"/><w:spacing w:before="100" w:after="80"/></w:pPr>
  <w:r><w:drawing>
    <wp:inline distT="0" distB="0" distL="0" distR="0">
      <wp:extent cx="{cx}" cy="{cy}"/>
      <wp:effectExtent l="0" t="0" r="0" b="0"/>
      <wp:docPr id="{image_id}" name="Picture {image_id}" descr="{esc(alt)}"/>
      <wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>
      <a:graphic>
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:pic>
            <pic:nvPicPr><pic:cNvPr id="{image_id}" name="{esc(path.name)}"/><pic:cNvPicPr/></pic:nvPicPr>
            <pic:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
            <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
          </pic:pic>
        </a:graphicData>
      </a:graphic>
    </wp:inline>
  </w:drawing></w:r>
</w:p>"""


def table(rows: list[list[str]]) -> str:
    if not rows:
        return ""
    cols = max(len(row) for row in rows)
    width = 9000 // max(cols, 1)
    row_xml: list[str] = []
    for r_idx, row in enumerate(rows):
        cells: list[str] = []
        for c_idx in range(cols):
            value = row[c_idx] if c_idx < len(row) else ""
            fill = '<w:shd w:fill="EDE9FE"/>' if r_idx == 0 else ""
            cell_p = paragraph(clean_markdown(value), style="TableText", force_bold=(r_idx == 0))
            cells.append(
                f'<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/>{fill}<w:vAlign w:val="center"/></w:tcPr>{cell_p}</w:tc>'
            )
        row_xml.append(f"<w:tr>{''.join(cells)}</w:tr>")
    return f"""
<w:tbl>
  <w:tblPr>
    <w:tblW w:w="9000" w:type="dxa"/>
    <w:tblLayout w:type="fixed"/>
    <w:tblCellMar><w:top w:w="90" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar>
    <w:tblBorders>
      <w:top w:val="single" w:sz="4" w:color="D9D5E8"/>
      <w:left w:val="single" w:sz="4" w:color="D9D5E8"/>
      <w:bottom w:val="single" w:sz="4" w:color="D9D5E8"/>
      <w:right w:val="single" w:sz="4" w:color="D9D5E8"/>
      <w:insideH w:val="single" w:sz="4" w:color="E5E7EB"/>
      <w:insideV w:val="single" w:sz="4" w:color="E5E7EB"/>
    </w:tblBorders>
  </w:tblPr>
  {''.join(row_xml)}
</w:tbl>
<w:p><w:pPr><w:spacing w:after="80"/></w:pPr></w:p>"""


def parse_markdown(path: Path):
    lines = path.read_text(encoding="utf-8").splitlines()
    blocks: list[tuple] = []
    images: list[tuple[Path, str]] = []
    i = 0
    para_buf: list[str] = []

    def flush_para() -> None:
        if para_buf:
            blocks.append(("p", " ".join(item.strip() for item in para_buf)))
            para_buf.clear()

    while i < len(lines):
        line = lines[i].rstrip()
        if not line.strip():
            flush_para()
            i += 1
            continue
        if line.strip() == "---":
            flush_para()
            blocks.append(("rule",))
            i += 1
            continue
        heading_match = re.match(r"^(#{1,4})\s+(.+)$", line)
        if heading_match:
            flush_para()
            blocks.append(("heading", len(heading_match.group(1)), clean_markdown(heading_match.group(2))))
            i += 1
            continue
        image_match = re.match(r"^!\[([^]]*)\]\(([^)]+)\)$", line.strip())
        if image_match:
            flush_para()
            image_path = (path.parent / image_match.group(2)).resolve()
            images.append((image_path, image_match.group(1)))
            blocks.append(("image", len(images) - 1))
            i += 1
            continue
        if line.startswith(">"):
            flush_para()
            quote_lines = []
            while i < len(lines) and lines[i].startswith(">"):
                quote_lines.append(lines[i].lstrip("> "))
                i += 1
            blocks.append(("quote", "\n".join(quote_lines)))
            continue
        if line.startswith("|") and i + 1 < len(lines) and re.match(r"^\|?\s*:?-+", lines[i + 1]):
            flush_para()
            rows: list[list[str]] = []
            rows.append([cell.strip() for cell in line.strip().strip("|").split("|")])
            i += 2  # Skip the Markdown alignment separator.
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append([cell.strip() for cell in lines[i].strip().strip("|").split("|")])
                i += 1
            blocks.append(("table", rows))
            continue
        checkbox_match = re.match(r"^- \[([ xX])\]\s+(.+)$", line)
        if checkbox_match:
            flush_para()
            marker = "☒" if checkbox_match.group(1).lower() == "x" else "☐"
            blocks.append(("list", f"{marker} {checkbox_match.group(2)}", 0))
            i += 1
            continue
        bullet_match = re.match(r"^(\s*)[-*]\s+(.+)$", line)
        if bullet_match:
            flush_para()
            depth = len(bullet_match.group(1)) // 2
            blocks.append(("list", f"• {bullet_match.group(2)}", depth))
            i += 1
            continue
        number_match = re.match(r"^(\s*)(\d+)\.\s+(.+)$", line)
        if number_match:
            flush_para()
            depth = len(number_match.group(1)) // 2
            blocks.append(("list", f"{number_match.group(2)}. {number_match.group(3)}", depth))
            i += 1
            continue
        if line.startswith("*") and line.endswith("*") and not line.startswith("**"):
            flush_para()
            blocks.append(("caption", clean_markdown(line.strip("*"))))
            i += 1
            continue
        para_buf.append(line)
        i += 1
    flush_para()
    return blocks, images


def styles_xml() -> str:
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="{W_NS}">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" w:eastAsia="Microsoft YaHei"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:color w:val="242234"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="90" w:line="330" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="100" w:line="330" w:lineRule="auto"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Subtitle"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:before="300" w:after="240"/></w:pPr><w:rPr><w:rFonts w:eastAsia="Microsoft YaHei"/><w:b/><w:color w:val="5B21B6"/><w:sz w:val="40"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="110"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:eastAsia="Microsoft YaHei"/><w:b/><w:color w:val="5B21B6"/><w:sz w:val="30"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="220" w:after="90"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:rFonts w:eastAsia="Microsoft YaHei"/><w:b/><w:color w:val="6D28D9"/><w:sz w:val="26"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="170" w:after="70"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:rFonts w:eastAsia="Microsoft YaHei"/><w:b/><w:color w:val="4338CA"/><w:sz w:val="23"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="140" w:after="60"/><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:rFonts w:eastAsia="Microsoft YaHei"/><w:b/><w:color w:val="374151"/><w:sz w:val="21"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360"/><w:spacing w:before="80" w:after="120"/><w:shd w:fill="F5F3FF"/><w:pBdr><w:left w:val="single" w:sz="18" w:color="8B5CF6" w:space="10"/></w:pBdr></w:pPr><w:rPr><w:color w:val="4B5563"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="Caption"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:after="150"/></w:pPr><w:rPr><w:i/><w:color w:val="6B7280"/><w:sz w:val="18"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ListText"><w:name w:val="List Text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="45"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="280" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="18"/></w:rPr></w:style>
</w:styles>"""


def build_docx(md_path: Path) -> Path:
    blocks, images = parse_markdown(md_path)
    body: list[str] = []
    for block in blocks:
        kind = block[0]
        if kind == "heading":
            level, value = block[1], block[2]
            body.append(paragraph(value, "Title" if level == 1 else f"Heading{level}"))
        elif kind == "p":
            body.append(paragraph(block[1]))
        elif kind == "quote":
            body.append(paragraph(block[1], "Quote"))
        elif kind == "caption":
            body.append(paragraph(block[1], "Caption", italic=True))
        elif kind == "list":
            body.append(paragraph(block[1], "ListText", indent=360 + block[2] * 360))
        elif kind == "table":
            body.append(table(block[1]))
        elif kind == "image":
            image_idx = block[1]
            img_path, alt = images[image_idx]
            body.append(drawing(f"rId{image_idx + 2}", image_idx + 1, img_path, alt))
        elif kind == "rule":
            body.append('<w:p><w:pPr><w:spacing w:before="100" w:after="100"/><w:pBdr><w:bottom w:val="single" w:sz="6" w:color="D8B4FE"/></w:pBdr></w:pPr></w:p>')

    sect = """
<w:sectPr>
  <w:pgSz w:w="11906" w:h="16838"/>
  <w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="600" w:footer="600" w:gutter="0"/>
  <w:cols w:space="720"/>
</w:sectPr>"""
    document = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="{W_NS}" xmlns:r="{R_NS}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>{''.join(body)}{sect}</w:body>
</w:document>"""

    rels = [
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    ]
    for idx, (image_path, _) in enumerate(images, start=2):
        rels.append(
            f'<Relationship Id="rId{idx}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image{idx - 1}{image_path.suffix.lower()}"/>'
        )
    document_rels = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{''.join(rels)}</Relationships>"""

    content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="jpg" ContentType="image/jpeg"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>"""

    root_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>"""

    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    title = clean_markdown(next((b[2] for b in blocks if b[0] == "heading" and b[1] == 1), md_path.stem))
    core = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>{esc(title)}</dc:title><dc:creator>JamaAI 文档整理</dc:creator><cp:lastModifiedBy>JamaAI 文档整理</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified>
</cp:coreProperties>"""
    app = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>JamaAI Documentation Builder</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>1.0</AppVersion></Properties>"""

    out_path = md_path.with_suffix(".docx")
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", root_rels)
        zf.writestr("docProps/core.xml", core)
        zf.writestr("docProps/app.xml", app)
        zf.writestr("word/document.xml", document)
        zf.writestr("word/styles.xml", styles_xml())
        zf.writestr("word/_rels/document.xml.rels", document_rels)
        for idx, (image_path, _) in enumerate(images, start=1):
            if not image_path.exists():
                raise FileNotFoundError(image_path)
            zf.write(image_path, f"word/media/image{idx}{image_path.suffix.lower()}")
    return out_path


if __name__ == "__main__":
    for source in MANUALS:
        output = build_docx(source)
        print(f"built: {output.name} ({output.stat().st_size} bytes)")
