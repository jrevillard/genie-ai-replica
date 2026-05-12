# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""Unit tests for agricultural taxonomy extraction helpers."""

import unittest

from agri_metadata.fallback_extract import fallback_extract
from agri_metadata.json_utils import extract_json_object
from agri_metadata.normalize import normalize_llm_output
from agri_metadata.schema import (
    AgricultureModel,
    LlmTaxonomyOutput,
    NormalizedTaxonomyPayload,
    taxonomy_to_chunk_flat,
)


class TestJsonUtils(unittest.TestCase):
    def test_extract_from_fence(self):
        raw = '```json\n{"isRelevant": true, "Location": {"Country": ["Lesotho"]}}\n```'
        data = extract_json_object(raw)
        self.assertEqual(data["Location"]["Country"], ["Lesotho"])

    def test_malformed_repair_brace(self):
        raw = 'prefix {"isRelevant": false} trailing'
        data = extract_json_object(raw)
        self.assertEqual(data["isRelevant"], False)


class TestNormalize(unittest.TestCase):
    def test_maize_synonym(self):
        raw = LlmTaxonomyOutput(Agriculture=AgricultureModel(CropName=["corn"]))
        out = normalize_llm_output(raw)
        self.assertIn("Maize", out.Agriculture.get("CropName", []))


class TestFallback(unittest.TestCase):
    def test_lesotho_keyword(self):
        out = fallback_extract("Agricultural extension in Lesotho focuses on maize.")
        n = normalize_llm_output(out)
        self.assertTrue(n.isRelevant)
        self.assertIn("Lesotho", n.Location.get("Country", []))


class TestChunkFlat(unittest.TestCase):
    def test_flat_keys(self):
        tax = NormalizedTaxonomyPayload(
            Location={"Country": ["Lesotho"], "Region": [], "District": [], "Village": [], "GeoScope": []},
            Agriculture={
                "CropCategory": [],
                "CropName": ["Maize"],
                "Varietal": [],
                "Livestock": [],
                "FarmingSystem": [],
                "IrrigationType": [],
                "Season": [],
                "ProductionScale": [],
                "OrganicStatus": [],
            },
            Content={
                "Topic": [],
                "SubTopic": [],
                "DocumentType": [],
                "UseCase": [],
                "Audience": [],
                "Methodology": [],
            },
            Environment={
                "Climate": [],
                "RainfallPattern": [],
                "Altitude": [],
                "TemperatureRange": [],
                "Soil": [],
                "WaterAvailability": [],
                "AgroEcologicalZone": [],
            },
            Risk={"Pest": [], "Disease": [], "ClimateRisk": [], "SoilRisk": []},
            Economics={"MarketFocus": [], "ValueChainStage": [], "FinancialTopic": []},
            Governance={"PolicyMentioned": [], "NGOs": [], "GovernmentBodies": [], "Programs": []},
        )
        flat = taxonomy_to_chunk_flat(tax)
        self.assertEqual(flat["tax_countries"], ["Lesotho"])
        self.assertEqual(flat["tax_crop_names"], ["Maize"])


if __name__ == "__main__":
    unittest.main()
