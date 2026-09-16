#!/usr/bin/env python3
"""Fetch complete Identica listings (category cards + sitemap) into JSON."""

from __future__ import annotations

import json
import re
import sys
import time
from html import unescape
from pathlib import Path
from urllib.request import Request, urlopen

SITEMAP_URL = "https://www.mahakaladvertising.com/sitemap.html"
OUT = Path(__file__).with_name("identica-products.json")

# IndiaMART page file -> seeded group slug
PAGE_TO_GROUP: dict[str, str] = {
    "corporate-signage.html": "corporate-signage",
    "led-signages.html": "led-signages",
    "led-letters.html": "led-letters",
    "led-signage-board.html": "led-signage-board",
    "office-building-signage-board.html": "office-and-building-signage-board",
    "retail-signages.html": "retail-signages",
    "led-sign-board.html": "led-sign-board",
    "name-plates.html": "signage-name-plates",
    "name-plate.html": "signage-name-plates",
    "nameplates.html": "signage-name-plates",
    "acrylic-name-plate.html": "signage-name-plates",
    "aluminum-nameplates.html": "signage-name-plates",
    "pylons-lolipop.html": "pylons-lolipop",
    "acrylic-box-solid-letters.html": "acrylic-box-solid-letters",
    "solid-letters.html": "solid-letters",
    "led-signages-logo.html": "led-signages-logo",
    "safety-signs.html": "safety-signs",
    "safety-signage.html": "safety-signs",
    "acp-sign-boards.html": "safety-signs",
    "graphics-service.html": "graphics-service",
    "sky-signages.html": "sky-signages",
    "digital-standee.html": "digital-standee",
    "digital-standies.html": "digital-standee",
    "acrylic-stand.html": "digital-standee",
    "glow-signs-edge-lights.html": "glow-signs",
    "glow-signs.html": "glow-signs",
    "acp-glow-sign-board.html": "glow-signs",
    "glow-sign-board.html": "glow-signs",
    "metal-labels.html": "metal-labels",
    "cladding-work.html": "cladding-work",
    "uv-printing-services.html": "uv-printing-services",
    "flex-branding-work.html": "flex-branding-work",
    "sign-board-poles.html": "sign-board-poles",
    "new-products.html": "corporate-signage",
    "new-items.html": "corporate-signage",
}

# Child slugs from seed-identica-categories.ts, keyed by group.
GROUP_CHILDREN: dict[str, list[tuple[str, str]]] = {
    "corporate-signage": [
        ("Directional Acrylic Sign Board", "directional-acrylic-sign-board"),
        ("Office Name Plate", "office-name-plate"),
        ("Corporate LED Signage", "corporate-led-signage"),
        ("Stainless Steel 3D Letters", "stainless-steel-3d-letters"),
        ("Wayfinding Sign Board", "wayfinding-sign-board"),
        ("Metal Brass 3D Solid Letter", "metal-brass-3d-solid-letter"),
        ("Acrylic LED Letter", "acrylic-led-letter"),
        ("3D Box Letter", "3d-box-letter"),
        ("Rose Gold Letter", "rose-gold-letter"),
        ("Reception Signage Board", "reception-signage-board"),
        ("SS Corporate Signage", "ss-corporate-signage"),
        ("Acrylic Office Name Board", "acrylic-office-name-board"),
    ],
    "led-signages": [
        ("Outdoor Sign Board", "outdoor-sign-board"),
        ("Acrylic Signage", "acrylic-signage"),
        ("LED Box Type Letters", "led-box-type-letters"),
        ("SS Signage Letters", "ss-signage-letters"),
        ("Retail Signage Boards", "retail-signage-boards"),
        ("LED Backlite Letters", "led-backlite-letters"),
        ("Exterior Signs", "exterior-signs"),
        ("General LED Signage", "general-led-signage"),
    ],
    "led-letters": [
        ("LED Signage Letter", "led-signage-letter"),
        ("3D LED Letter", "3d-led-letter"),
        ("Metal Channelium Letters", "metal-channelium-letters"),
        ("LED Acrylic Letters", "led-acrylic-letters"),
        ("CU Continental Signage System", "cu-continental-signage-system"),
        ("Channel Signs Letters", "channel-signs-letters"),
        ("Side Light Letters", "side-light-letters"),
        ("Brass Signage Letter", "brass-signage-letter"),
        ("Acrylic LED Glow Letters", "acrylic-led-glow-letters"),
        ("Outdoor Signage Letter", "outdoor-signage-letter"),
    ],
    "led-signage-board": [
        ("Letter Signage Board", "letter-signage-board"),
        ("3D Acrylic LED Sign Board", "3d-acrylic-led-sign-board"),
        ("Office Signage Board", "office-signage-board"),
        ("Acrylic Box Letters", "acrylic-box-letters"),
    ],
    "office-and-building-signage-board": [
        ("3D LED Signages Board", "3d-led-signages-board"),
        ("3D LED Sign Board", "3d-led-sign-board"),
        ("Acrylic Letters Signs", "acrylic-letters-signs"),
    ],
    "retail-signages": [
        ("Restaurant Menu Sign Board", "restaurant-menu-sign-board"),
        ("Acrylic Sign Board", "acrylic-sign-board"),
        ("Letter Sign Boards", "letter-sign-boards"),
        ("Stainless Steel Sign Board", "stainless-steel-sign-board"),
    ],
    "led-sign-board": [
        ("3D Acrylic Sign Board", "3d-acrylic-sign-board"),
        ("Outdoor Signage Board", "outdoor-signage-board"),
        ("Acrylic Sign Boards", "acrylic-sign-boards"),
    ],
    "signage-name-plates": [
        ("Door Name Plate", "door-name-plate"),
        ("Stainless Steel Name Plate", "stainless-steel-name-plate"),
        ("Meeting Room Name Plate", "meeting-room-name-plate"),
        ("Glass Nameplate with Vinyl", "glass-nameplate-with-vinyl"),
        ("Name Plate Directory", "name-plate-directory"),
        ("Room Number Plate", "room-number-plate"),
        ("Brass Name Plates", "brass-name-plates"),
        ("Corporate Name Plate", "corporate-name-plate"),
        ("Acrylic Stainless Steel Name Plate", "acrylic-stainless-steel-name-plate"),
        ("Name Plate Lobby Area", "name-plate-lobby-area"),
        ("Aluminum Nameplates", "aluminum-nameplates"),
        ("Etching Name Plates", "etching-name-plates"),
        ("Transparent Acrylic Name Plate", "transparent-acrylic-name-plate"),
    ],
    "pylons-lolipop": [
        ("Vertical Pylon Signage", "vertical-pylon-signage"),
        ("LED Pylon Signage", "led-pylon-signage"),
        ("Signage Board Stand Outdoor", "signage-board-stand-outdoor"),
        ("ACP Pylon Signage", "acp-pylon-signage"),
        ("4A External Directional Signage", "4a-external-directional-signage"),
        ("Pylon Lollypop Signage", "pylon-lollypop-signage"),
        ("Pole Display", "pole-display"),
    ],
    "acrylic-box-solid-letters": [
        ("Acrylic Signage Board", "acrylic-signage-board"),
        ("ACP Glow Signage", "acp-glow-signage"),
        ("Acrylic Solid Letter", "acrylic-solid-letter"),
        ("Acrylic & Metal Letter", "acrylic-and-metal-letter"),
    ],
    "solid-letters": [
        ("Retail 3D Signages", "retail-3d-signages"),
        ("Acrylic Backlit 3D Letter Sign Board", "acrylic-backlit-3d-letter-sign-board"),
        ("Led Signage Board", "solid-led-signage-board"),
    ],
    "led-signages-logo": [
        ("LED Restaurant Signage Logo", "led-restaurant-signage-logo"),
        ("LED Face Signage Logo", "led-face-signage-logo"),
        ("LED Signages Logo", "led-signages-logo-mark"),
    ],
    "safety-signs": [
        ("Fire Safety Signs", "fire-safety-signs"),
        ("Safety Sign Board", "safety-sign-board"),
        ("Acrylic Displays Signage", "acrylic-displays-signage"),
        ("Warning Sign Board", "warning-sign-board"),
        ("ACP Sign Boards", "acp-sign-boards"),
    ],
    "graphics-service": [
        ("Wall Graphics Pasting", "wall-graphics-pasting"),
        ("Wall Graphics Stickers", "wall-graphics-stickers"),
        ("Corporate Office Wall Graphics", "corporate-office-wall-graphics"),
        ("Wall Graphics Vinyl", "wall-graphics-vinyl"),
        ("Wall Graphics Printing Service", "wall-graphics-printing-service"),
    ],
    "sky-signages": [
        ("Building Rooftop Signages", "building-rooftop-signages"),
        ("3D LED Sky Signage", "3d-led-sky-signage"),
        ("Sky Signage", "sky-signage"),
    ],
    "digital-standee": [
        ("Digital Standee Advertising Board", "digital-standee-advertising-board"),
        ("Digital Display Standee", "digital-display-standee"),
        ("Digital Board Stand", "digital-board-stand"),
        ("Digital LED Standee", "digital-led-standee"),
        ("LED Video Wall & Digital Display Solutions", "led-video-wall-digital-display"),
    ],
    "glow-signs": [
        ("Clip On Board", "clip-on-board"),
        ("Glow Sign Board", "glow-sign-board"),
        ("ACP Glow Sign Board", "acp-glow-sign-board"),
        ("Slim Aluminum Clip On LED Backlit Frame", "slim-aluminum-clip-on-led-backlit-frame"),
    ],
    "metal-labels": [
        ("Stainless Steel Metal Labels", "stainless-steel-metal-labels"),
        ("Brass Pocket Badges", "brass-pocket-badges"),
    ],
    "cladding-work": [
        ("ACP Cladding Work", "acp-cladding-work"),
        ("Cladding With 3D Letters Signage", "cladding-with-3d-letters-signage"),
    ],
    "uv-printing-services": [
        ("UV Printing Service", "uv-printing-service"),
        ("UV Vinyl Printing Services", "uv-vinyl-printing-services"),
    ],
    "flex-branding-work": [
        ("Flex Sign Board MS Frame", "flex-sign-board-ms-frame"),
    ],
    "sign-board-poles": [
        ("Median Pole for Branding", "median-pole-for-branding"),
    ],
}

# Extra IndiaMART pages that should land on a specific child.
PAGE_DEFAULT_CHILD: dict[str, str] = {
    "acp-glow-sign-board.html": "acp-glow-sign-board",
    "glow-sign-board.html": "glow-sign-board",
    "acp-sign-boards.html": "acp-sign-boards",
    "aluminum-nameplates.html": "aluminum-nameplates",
    "acrylic-stand.html": "led-video-wall-digital-display",
    "name-plate.html": "corporate-name-plate",
}


BOILERPLATE = (
    "with the trust of the customers",
    "we are manufacturers of high quality",
    "we are a leading manufacturer",
    "we are a most trusted name",
    "we are recognized as the leading",
    "we are one of the reputed",
    "we are supplier of customised",
    "to meet the requirements of clients",
    "with our expertise in this domain",
    "our product range includes",
    "manufacturer of a wide range",
    "pioneers in the industry",
    "prominent & leading manufacturer",
    "features:",
    "additional information:",
    "product details:",
    "get best price",
    "non maintenance (uninterrupted )",
    "highest quality available raw material",
    "high end raw material",
    "superior finishing.",
    "energy efficiency",
    "uniform light output",
)


def slugify(value: str) -> str:
    text = unescape(value).lower().replace("&", "and")
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def larger_image(url: str) -> str:
    return re.sub(r"-(?:125x125|500x500)(\.[a-zA-Z]+)$", r"-1000x1000\1", url)


def strip_tags(value: str) -> str:
    text = re.sub(r"<[^>]+>", " ", unescape(value))
    text = text.replace("\xa0", " ").replace("&nbsp;", " ")
    return re.sub(r"\s+", " ", text).strip()


def pick_category(group: str, page: str, hash_slug: str, name: str) -> str:
    children = GROUP_CHILDREN.get(group, [])
    child_slugs = {slug for _, slug in children}
    name_slug = slugify(name)

    if hash_slug in child_slugs:
        return hash_slug
    for child_name, child_slug in children:
        if slugify(child_name) == name_slug:
            return child_slug
    for child_name, child_slug in children:
        child_name_slug = slugify(child_name)
        if child_name_slug and (
            child_name_slug == hash_slug
            or name_slug.startswith(child_name_slug)
            or child_name_slug.startswith(name_slug)
        ):
            return child_slug
    default_child = PAGE_DEFAULT_CHILD.get(page)
    if default_child and default_child in child_slugs:
        return default_child
    return group


def parse_price(raw: str) -> str:
    cleaned = unescape(raw).replace("\xa0", " ").replace(",", "").strip()
    match = re.search(r"(\d+(?:\.\d+)?)", cleaned)
    if not match:
        return "0.00"
    amount = match.group(1)
    if "." not in amount:
        return f"{amount}.00"
    whole, frac = amount.split(".", 1)
    return f"{whole}.{frac[:2].ljust(2, '0')}"


def fetch(url: str) -> str:
    req = Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; PrintForgeBot/1.0)"})
    with urlopen(req, timeout=45) as response:
        return response.read().decode("utf-8", "replace")


def collect_images(html: str) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()
    multi = re.search(r'data-multiimg="([^"]+)"', html, re.I)
    if multi:
        for part in multi.group(1).split(","):
            url = larger_image(part.strip())
            if url.startswith("https://5.imimg.com/") and url not in seen:
                seen.add(url)
                found.append(url)
    for match in re.finditer(
        r'(?:data-bimg|dataimg)="(https://5\.imimg\.com[^"]+)"', html, re.I
    ):
        url = larger_image(match.group(1))
        if url not in seen:
            seen.add(url)
            found.append(url)
    return found


def parse_min_quantity(card: str) -> tuple[int, str]:
    match = re.search(
        r"Minimum Order Quantity:\s*<span[^>]*>([^<]+)</span>", card, re.I
    )
    if not match:
        return 1, ""
    raw = strip_tags(match.group(1))
    number = re.search(r"(\d[\d,]*)", raw)
    qty = int(number.group(1).replace(",", "")) if number else 1
    return max(qty, 1), raw


def parse_details_table(card: str) -> dict[str, str]:
    specs: dict[str, str] = {}
    for key, value in re.findall(
        r"<tr>\s*<td>(.*?)</td>\s*<td>(.*?)</td>", card, re.I | re.S
    ):
        label = strip_tags(key)
        text = strip_tags(value)
        if not label or not text or label.lower() in {"product details"}:
            continue
        if label not in specs:
            specs[label] = text
    return specs


def parse_description(card: str) -> str:
    blob = strip_tags(card)
    parts = re.split(r"(?<=[.!?])\s+", blob)
    kept: list[str] = []
    for part in parts:
        lower = part.lower().strip()
        if len(lower) < 40:
            continue
        if any(lower.startswith(prefix) or prefix in lower[:80] for prefix in BOILERPLATE):
            continue
        if "product price" in lower or "minimum order quantity" in lower:
            continue
        kept.append(part.strip())
        if len(" ".join(kept)) > 700:
            break
    text = " ".join(kept).strip()
    return text[:800]


def parse_extra_info(card: str) -> dict[str, str]:
    extra: dict[str, str] = {}
    for label in ("Production Capacity", "Delivery Time", "Packaging Details"):
        match = re.search(rf"{label}:\s*([^<]+)", card, re.I)
        if match:
            value = strip_tags(match.group(1))
            if value:
                extra[label] = value
    return extra


def make_product(
    *,
    page: str,
    group: str,
    hash_slug: str,
    name: str,
    price: str,
    unit: str,
    images: list[str],
    min_quantity: int,
    specs: dict[str, str],
) -> dict:
    category_slug = pick_category(group, page, hash_slug, name)
    name_part = slugify(name) or hash_slug or "product"
    unit_part = slugify(unit) or "quote"
    price_part = price.replace(".", "-")
    slug = f"identica-{group}-{name_part}-{price_part}-{unit_part}"[:180]
    specifications = {
        "Source": "Identica listing on mahakaladvertising.com",
        "Listing": f"https://www.mahakaladvertising.com/{page}#{hash_slug}"
        if hash_slug
        else f"https://www.mahakaladvertising.com/{page}",
        **specs,
    }
    if unit:
        specifications["Price unit"] = unit
    if price == "0.00":
        specifications["Pricing"] = "Get quote"
    return {
        "categorySlug": category_slug,
        "groupSlug": group,
        "name": name,
        "slug": slug,
        "price": price,
        "minQuantity": min_quantity,
        "imageUrl": images[0] if images else "",
        "imageUrls": images,
        "specifications": specifications,
    }


def parse_category_cards(html: str, page: str, group: str) -> list[dict]:
    chunks = re.split(r'<div class="prdCard\b', html)
    products: list[dict] = []
    for index, card in enumerate(chunks[1:], start=1):
        prev = chunks[index - 1]
        ids = re.findall(r'<a id="([^"]+)"', prev)
        hash_slug = unescape(ids[-1]).strip().lower() if ids else ""
        heading = re.search(r"<h2[^>]*>(.*?)</h2>", card, re.I | re.S)
        if not heading:
            continue
        name = strip_tags(heading.group(1)).replace("''", "'")
        if not name or name.lower() in {"identica"}:
            continue

        price_match = re.search(
            r"Product Price:.*?<span>\s*Rs\.?\s*([^<]+)</span>\s*<span>([^<]*)</span>",
            card,
            re.I | re.S,
        )
        if price_match:
            price = parse_price(price_match.group(1))
            unit = strip_tags(price_match.group(2)).lstrip("/ ").strip()
        else:
            fallback = re.search(r"Rs\.?\s*([\d,]+(?:\.\d+)?)", card)
            price = parse_price(fallback.group(1)) if fallback else "0.00"
            unit = ""

        min_quantity, moq_label = parse_min_quantity(card)
        specs = parse_details_table(card)
        specs.update(parse_extra_info(card))
        description = parse_description(card)
        if description:
            specs["Details"] = description
        if moq_label:
            specs["Minimum order"] = moq_label

        products.append(
            make_product(
                page=page,
                group=group,
                hash_slug=hash_slug,
                name=name,
                price=price,
                unit=unit,
                images=collect_images(card),
                min_quantity=min_quantity,
                specs=specs,
            )
        )
    return products


def parse_sitemap_fallbacks(html: str) -> list[dict]:
    block_re = re.compile(
        r'<a href="(?P<href>[^"#]+\.html)#(?P<hash>[^"]+)" class="dfx bg2">(?P<body>.*?)</a>',
        re.I | re.S,
    )
    products: list[dict] = []
    for match in block_re.finditer(html):
        href = match.group("href").split("/")[-1]
        hash_slug = unescape(match.group("hash")).strip().lower()
        body = match.group("body")
        name_match = re.search(r'<span class="db">([^<]+)</span>', body)
        if not name_match:
            continue
        name = unescape(name_match.group(1)).replace("''", "'").strip()
        group = PAGE_TO_GROUP.get(href)
        if not name or not group:
            if name and href not in PAGE_TO_GROUP:
                print(f"unmapped page {href} ({name})", file=sys.stderr)
            continue
        price_match = re.search(
            r"Approx\.\s*Price.*?<strong[^>]*>(.*?)</strong>\s*(?:/\s*([^<]+))?",
            body,
            re.I | re.S,
        )
        if price_match:
            price = parse_price(re.sub(r"<[^>]+>", "", price_match.group(1)))
            unit = strip_tags(price_match.group(2) or "").lstrip("/ ").strip()
        else:
            price, unit = "0.00", ""
        img = re.search(r'dataimg="(https://5\.imimg\.com[^"]+)"', body)
        images = [larger_image(img.group(1))] if img else []
        products.append(
            make_product(
                page=href,
                group=group,
                hash_slug=hash_slug,
                name=name,
                price=price,
                unit=unit,
                images=images,
                min_quantity=1,
                specs={},
            )
        )
    return products


def listing_key(item: dict) -> tuple[str, str, str, str]:
    return (
        item["groupSlug"],
        slugify(item["name"]),
        item["price"],
        slugify(item["specifications"].get("Price unit", "")),
    )


def merge_products(primary: list[dict], fallback: list[dict]) -> list[dict]:
    merged: list[dict] = []
    by_key: dict[tuple[str, str, str, str], dict] = {}
    for item in primary + fallback:
        key = listing_key(item)
        existing = by_key.get(key)
        if existing:
            if len(item.get("specifications", {})) > len(existing.get("specifications", {})):
                existing["specifications"] = item["specifications"]
            if len(item.get("imageUrls") or []) > len(existing.get("imageUrls") or []):
                existing["imageUrls"] = item["imageUrls"]
                existing["imageUrl"] = item.get("imageUrl") or existing.get("imageUrl")
            if item.get("minQuantity", 1) > existing.get("minQuantity", 1):
                existing["minQuantity"] = item["minQuantity"]
            continue
        by_key[key] = item
        merged.append(item)

    used: dict[str, int] = {}
    for item in merged:
        base = item["slug"]
        n = used.get(base, 0)
        used[base] = n + 1
        if n:
            item["slug"] = f"{base}-{n + 1}"
    return merged


def sitemap_pages(html: str) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()
    for match in re.finditer(
        r'<li class="pd1 Stmp clr4"><a href="([^"]+\.html)"', html, re.I
    ):
        page = match.group(1).split("/")[-1]
        if page not in seen:
            seen.add(page)
            found.append(page)
    for page in PAGE_TO_GROUP:
        if page not in seen:
            found.append(page)
            seen.add(page)
    return found


def main() -> None:
    sitemap = fetch(SITEMAP_URL)
    pages = sitemap_pages(sitemap)
    primary: list[dict] = []
    for page in pages:
        group = PAGE_TO_GROUP.get(page)
        if not group:
            print(f"skip unmapped listing page {page}", file=sys.stderr)
            continue
        url = f"https://www.mahakaladvertising.com/{page}"
        try:
            html = fetch(url)
        except Exception as error:  # noqa: BLE001
            print(f"failed {url}: {error}", file=sys.stderr)
            continue
        cards = parse_category_cards(html, page, group)
        print(f"  {len(cards):3d} {page}")
        primary.extend(cards)
        time.sleep(0.15)

    fallback = parse_sitemap_fallbacks(sitemap)
    products = merge_products(primary, fallback)

    by_group: dict[str, int] = {}
    with_image = 0
    with_specs = 0
    for item in products:
        by_group[item["groupSlug"]] = by_group.get(item["groupSlug"], 0) + 1
        if item.get("imageUrl"):
            with_image += 1
        if len(item.get("specifications", {})) > 3:
            with_specs += 1

    payload = {
        "source": "https://www.mahakaladvertising.com/ category listings + sitemap",
        "count": len(products),
        "products": products,
    }
    OUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT} ({len(products)} products, {with_image} with images, {with_specs} with details)")
    print("by group:")
    for slug, n in sorted(by_group.items(), key=lambda kv: (-kv[1], kv[0])):
        print(f"  {n:3d} {slug}")


if __name__ == "__main__":
    main()
