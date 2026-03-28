"""
MCPClientManager — manages two stdio MCP subprocesses:
  - mapbox: npx @mapbox/mcp-server  (location geocoding via Mapbox Search API v6)
  - weather: python -m mcp_weather.main  (BMD WRF forecast + buffer creation)
"""
import asyncio
import os
from contextlib import AsyncExitStack

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


class MCPClientManager:
    def __init__(self):
        self._sessions: dict = {}
        self._exit_stack = AsyncExitStack()

    async def start(self):
        """Launch both MCP subprocess sessions."""
        mapbox_token = os.getenv("MAPBOX_ACCESS_TOKEN", "")

        mapbox_params = StdioServerParameters(
            command="npx",
            args=["-y", "@mapbox/mcp-server"],
            env={**os.environ, "MAPBOX_ACCESS_TOKEN": mapbox_token}
        )
        weather_params = StdioServerParameters(
            command="python",
            args=["-m", "mcp_weather.main"]
        )

        for key, params in [("mapbox", mapbox_params), ("weather", weather_params)]:
            stdio_transport = await self._exit_stack.enter_async_context(
                stdio_client(params)
            )
            read, write = stdio_transport
            session = await self._exit_stack.enter_async_context(
                ClientSession(read, write)
            )
            await session.initialize()
            self._sessions[key] = session

    async def stop(self):
        await self._exit_stack.aclose()

    async def geocode_location(self, location_name: str) -> dict:
        """
        Use the Mapbox MCP server to geocode a location name.

        Returns a dict with lat/lon and extracted district name.
        """
        session = self._sessions["mapbox"]
        result = await session.call_tool(
            "mapbox_geocoding_forward",
            {"q": location_name, "limit": 1, "country": "BD"}
        )
        raw_text = result.content[0].text if result.content else ""
        if not raw_text.strip():
            raise ValueError(f"Empty geocoding response for '{location_name}' — check MAPBOX_ACCESS_TOKEN")

        import json
        data = json.loads(raw_text)
        features = data.get("features", [])
        if not features:
            raise ValueError(f"No features returned for '{location_name}'")

        feature = features[0]
        coords = feature.get("geometry", {}).get("coordinates", [0, 0])
        district = self._extract_district_from_mapbox(feature)

        return {
            "longitude": coords[0],
            "latitude": coords[1],
            "district": district,
            "display_name": feature.get("properties", {}).get("full_address", location_name)
        }

    def _extract_district_from_mapbox(self, feature: dict) -> str:
        """Extract district name from a Mapbox v6 feature."""
        context = feature.get("properties", {}).get("context", {})
        district_info = context.get("district")
        if isinstance(district_info, dict):
            return district_info.get("name", "Unknown")

        # Fallback: if feature_type is district, use name
        if feature.get("properties", {}).get("feature_type") == "district":
            return feature["properties"].get("name", "Unknown")

        # Last resort: first word of full_address
        full_address = feature.get("properties", {}).get("full_address", "")
        return full_address.split(",")[0].strip() or "Unknown"

    async def call_weather_tool(self, tool_name: str, args: dict) -> str:
        """Call a tool on the weather MCP server and return raw text result."""
        session = self._sessions["weather"]
        result = await session.call_tool(tool_name, args)
        if result.content:
            return result.content[0].text
        return "{}"
