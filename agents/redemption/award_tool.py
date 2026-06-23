"""Seeded award-search tool for the Person C MVP.

The real external search integration is out of scope for this slice. This tool
turns fixture facts into a typed graph fragment shaped around schema-final v3.1
concepts: `redemption_options`, `external_quotes`, and `redeems_via`.
"""

from __future__ import annotations

from typing import Any


def search_seed_awards(
    fixture: dict[str, Any],
    *,
    city: str,
    nights: int,
    program_slug: str,
) -> dict[str, Any]:
    matching_awards = [
        award
        for award in fixture["award_options"]
        if award["city"] == city
        and award["nights"] == nights
        and award["program_slug"] == program_slug
    ]

    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    hotel_by_slug = {hotel["slug"]: hotel for hotel in fixture["hotels"]}

    for award in matching_awards:
        hotel = hotel_by_slug[award["hotel_slug"]]
        redemption_option_slug = _redemption_option_slug(award["slug"])
        source_tool = award["source_tool"]
        fetched_at = award["fetched_at"]

        nodes.append(
            {
                "node_type": "RedemptionOption",
                "slug": redemption_option_slug,
                "program_slug": award["program_slug"],
                "option_type": "transfer_partner",
                "cpp_basis_points": award["value_basis_points"],
                "description": f"{hotel['display_name']} - {city}, {nights} nights",
                "payload": {
                    "hotel_slug": hotel["slug"],
                    "hotel_name": hotel["display_name"],
                    "city": city,
                    "nights": nights,
                },
            }
        )
        nodes.append(
            {
                "node_type": "ExternalQuote",
                "slug": award["slug"],
                "quote_type": "award_availability",
                "program_slug": award["program_slug"],
                "redemption_option_slug": redemption_option_slug,
                "subject": f"{hotel['display_name']} award availability",
                "points_cost": award["points_total"],
                "source_tool": source_tool,
                "fetched_at": fetched_at,
                "payload": {
                    "available": award["available"],
                    "hotel_slug": hotel["slug"],
                    "city": city,
                    "nights": nights,
                },
            }
        )
        nodes.append(
            {
                "node_type": "ExternalQuote",
                "slug": award["cash_quote_slug"],
                "quote_type": "cash_price",
                "program_slug": award["program_slug"],
                "redemption_option_slug": redemption_option_slug,
                "subject": f"{hotel['display_name']} cash price",
                "value_cents": award["cash_total_cents"],
                "source_tool": source_tool,
                "fetched_at": fetched_at,
                "payload": {
                    "hotel_slug": hotel["slug"],
                    "city": city,
                    "nights": nights,
                },
            }
        )
        edges.append(
            {
                "edge_type": "redeems_via",
                "from_node_type": "RewardProgram",
                "from_slug": award["program_slug"],
                "to_node_type": "RedemptionOption",
                "to_slug": redemption_option_slug,
            }
        )

    return {
        "fragment_id": f"award-search:{city.lower()}:{program_slug}:{nights}n:v1",
        "source_tool": "seed_award_search",
        "fetched_at": fixture["as_of"],
        "nodes": nodes,
        "edges": edges,
    }


def _redemption_option_slug(award_slug: str) -> str:
    return award_slug.replace("award:", "redemption_option:", 1)
