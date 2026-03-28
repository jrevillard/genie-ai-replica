"""
FastMCP stdio server — exposes weather tools over the MCP stdio protocol.
Launched as a subprocess by MCPClientManager in mcp_client.py.
"""
from typing import List
from mcp.server.fastmcp import FastMCP
from mcp_weather.tools.buffer_point import create_buffer
from mcp_weather.tools.weather_forecast import fetch_forecast_logic

mcp = FastMCP("Weather Service")


@mcp.tool()
def buffer_point(latitude: float, longitude: float, radius_km: float) -> str:
    """Create a geodesic buffer zone around coordinates (WGS84 ellipsoid).

    Args:
        latitude:  Centre latitude in decimal degrees.
        longitude: Centre longitude in decimal degrees.
        radius_km: Buffer radius in kilometres.

    Returns:
        GeoJSON Polygon JSON string.
    """
    return create_buffer(latitude, longitude, radius_km)


@mcp.tool()
def retrieve_weather_forecast(district_name: str, forecast_days: int, parameters: List[str]) -> str:
    """Retrieve weather forecast from Bangladesh Meteorological Department BAMIS WRF table.

    Args:
        district_name: Bangladesh district name in English (e.g. "Pabna", "Dhaka").
        forecast_days: Number of days to forecast (1-7).
        parameters:    List of parameter names to include (unused, all returned by default).

    Returns:
        JSON string with location and forecast array.
    """
    return fetch_forecast_logic(district_name, forecast_days, parameters)


if __name__ == "__main__":
    mcp.run()
