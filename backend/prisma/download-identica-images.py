#!/usr/bin/env python3
"""Download Identica listing images into frontend/public/catalog/identica."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

CATALOG = Path(__file__).with_name("identica-products.json")
DEST = Path(__file__).resolve().parents[2] / "frontend" / "public" / "catalog" / "identica"
LOCAL_PREFIX = "local/catalog/identica"
WORKERS = 12


def best_remote_url(url: str) -> str:
    return re.sub(r"-(?:125x125|500x500)(\.[a-zA-Z]+)$", r"-1000x1000\1", url)


def extension_for(url: str, content_type: str) -> str:
    ctype = (content_type or "").split(";")[0].strip().lower()
    if ctype in {"image/jpeg", "image/jpg"}:
        return ".jpg"
    if ctype == "image/png":
        return ".png"
    if ctype == "image/webp":
        return ".webp"
    match = re.search(r"\.(jpe?g|png|webp|gif)(?:\?|$)", url, re.I)
    if not match:
        return ".jpg"
    ext = match.group(1).lower()
    return ".jpg" if ext == "jpeg" else f".{ext}"


def filename_for(url: str, ext: str) -> str:
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:16]
    return f"{digest}{ext}"


def fetch_bytes(url: str) -> tuple[bytes, str]:
    req = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; PrintForgeBot/1.0)",
            "Referer": "https://www.mahakaladvertising.com/",
        },
    )
    with urlopen(req, timeout=30) as response:
        data = response.read()
        content_type = response.headers.get("Content-Type", "")
    if len(data) < 1024 or data[:1] == b"<":
        raise ValueError(f"not an image ({len(data)} bytes)")
    return data, content_type


def download_one(url: str) -> tuple[str, str | None]:
    candidates = []
    best = best_remote_url(url)
    if best != url:
        candidates.append(best)
    candidates.append(url)
    last_error = ""
    for candidate in candidates:
        try:
            data, content_type = fetch_bytes(candidate)
            ext = extension_for(candidate, content_type)
            name = filename_for(url, ext)
            dest = DEST / name
            if not dest.exists() or dest.stat().st_size != len(data):
                dest.write_bytes(data)
            return url, f"{LOCAL_PREFIX}/{name}"
        except (HTTPError, URLError, TimeoutError, ValueError) as error:
            last_error = str(error)
            continue
    print(f"failed {url}: {last_error}", file=sys.stderr)
    return url, None


def collect_urls(products: list[dict]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for product in products:
        for url in product.get("imageUrls") or []:
            if url.startswith("http") and url not in seen:
                seen.add(url)
                ordered.append(url)
        url = product.get("imageUrl") or ""
        if url.startswith("http") and url not in seen:
            seen.add(url)
            ordered.append(url)
    return ordered


def rewrite_product(product: dict, mapping: dict[str, str]) -> None:
    rewritten: list[str] = []
    seen: set[str] = set()
    for url in product.get("imageUrls") or []:
        local = mapping.get(url, url)
        if local in seen:
            continue
        seen.add(local)
        rewritten.append(local)
    if not rewritten and product.get("imageUrl"):
        local = mapping.get(product["imageUrl"], product["imageUrl"])
        rewritten = [local]
    product["imageUrls"] = rewritten
    product["imageUrl"] = rewritten[0] if rewritten else product.get("imageUrl", "")


def main() -> None:
    payload = json.loads(CATALOG.read_text(encoding="utf-8"))
    products = payload["products"]
    urls = collect_urls(products)
    DEST.mkdir(parents=True, exist_ok=True)
    print(f"downloading {len(urls)} unique images -> {DEST}")

    mapping: dict[str, str] = {}
    ok = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = [pool.submit(download_one, url) for url in urls]
        for index, future in enumerate(as_completed(futures), start=1):
            source, local = future.result()
            if local:
                mapping[source] = local
                ok += 1
            if index % 100 == 0 or index == len(urls):
                print(f"  {index}/{len(urls)} ({ok} saved)")

    for product in products:
        rewrite_product(product, mapping)

    local_count = sum(
        1
        for product in products
        for url in product.get("imageUrls") or []
        if str(url).startswith(LOCAL_PREFIX)
    )
    payload["count"] = len(products)
    CATALOG.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"mapped {ok}/{len(urls)} downloads; {local_count} local image refs in catalog")


if __name__ == "__main__":
    main()
