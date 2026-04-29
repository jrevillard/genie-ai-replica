from abc import ABC, abstractmethod
from typing import Dict, Any, List


class BaseTool(ABC):
    name: str = "base_tool"
    description: str = "Base tool description"
    parameters: List[str] = []

    @abstractmethod
    async def execute(self, **kwargs) -> Dict[str, Any]:
        pass
