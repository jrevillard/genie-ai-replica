#!/usr/bin/env python3
"""Rebuild gold expected_chunks against the distilled 7-file corpus (Adem 10-21).

Same questions/answers/ids; new verbatim previews from the ingested .md files.
Self-check: each preview must be a substring of its file after chunk_identity
normalization (whitespace-collapsed, lowercased) — the same rule the matcher
applies, so report-only after this must resolve ~100%.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, "/home/adem/Desktop/Coding/genie-ai-replica-itu/tests/rag-benchmarks/eval")
from chunk_identity import normalize  # noqa: E402

D = "/tmp/gold-redo/"
FILES = {
    1: "1-land-soil-and-variety-selection.md",
    2: "2-planting-and-crop-care.md",
    3: "3-weed-control-and-herbicides.md",
    4: "4-insect-pest-control.md",
    5: "5-disease-control.md",
    6: "6-harvest-post-harvest-handling-and-storage.md",
    7: "7-value-addition.md",
}
TEXTS = {n: normalize(Path(D + f).read_text()) for n, f in FILES.items()}

# id -> [(file_number, preview), ...]
M = {
    "q-001": [(1, "Where possible, begin land preparation as early as the end of the winter cropping season to allow for weeds and plant residues to decompose before planting and reduce delays when rains begin.")],
    "q-002": [(1, "Consider conservation agriculture, which includes reduced or minimum tillage and no-till, along with residue retention, which will subsequently maintain organic matter and improve soil fertility.")],
    "q-003": [
        (1, "The best soils for maize are generally deep, fertile, well-drained and aerated loam, sandy loam and loamy soils rich in organic matter."),
        (1, "Test soil to establish soil pH as acidic soils can potentially reduce nutrient availability and affect maize growth. The locally recommended maize pH range in Lesotho is 5.5-7.0."),
    ],
    "q-004": [(1, "Maize can grow on different soil types, but soil suitability is important. The best soils for maize are generally deep, fertile, well-drained and aerated loam, sandy loam and loamy soils rich in organic matter.")],
    "q-005": [(1, "Then take a handful of moist soil, squeeze it into a ball, throw the ball about 50 cm into the air, and catch it. If it falls apart, it is poor soil with too much sand; if the ball sticks together, it is probably good soil with adequate clay.")],
    "q-006": [(1, "Soil texture influences how easily soil can be worked, how much water and air it holds, and how quickly water enters and moves through the soil.")],
    "q-007": [(1, "Soil testing provides important information on soil pH, nitrogen, phosphorus, potassium, organic matter, and other relevant soil properties (chemical and physical properties). It can also help determine the fertilizer requirements for the intended yield. Do not choose a fertilizer simply because it is available or because another farmer is using it.")],
    "q-008": [(1, "If soil acidity limits maize production, applying more fertilizer may not solve the problem. Where soil testing indicates acidity, consider agricultural lime at the recommended rate and timing. Liming can improve the soil environment for nutrient availability and root development.")],
    "q-009": [
        (1, "For nitrogen deficiency: Nitrogen deficiency may appear as yellowing or light-green maize, particularly beginning on older/lower leaves."),
        (1, "Phosphorus deficiency: Phosphorus deficiency may be associated with purple or reddish coloration, particularly on older leaves."),
        (1, "Potassium deficiency: Potassium deficiency may appear as yellowing or browning along the margins of older leaves, beginning around the leaf tips."),
        (1, "Zinc deficiency: Zinc deficiency may appear as pale or white striping between leaf veins, together with reduced leaf size and shortened internodes."),
    ],
    "q-010": [
        (1, "Consider using the 4R principle to guide fertilizer application."),
        (1, "The right rate: Apply fertilizer according to soil conditions, crop requirements, and the recommended rate. Applying too little may not supply enough nutrients, while excessive fertilizer can waste money, increase nutrient losses, and potentially damage the crop."),
    ],
    "q-011": [
        (1, "Basal fertilizer: Apply an appropriate basal fertilizer at planting(6:2:1 (26), 6:2:1 (31), 2:3:4 (30), 20:7:3 (30), and 1:1:1 (39), or according to the recommended planting program, where the soil requires it. Basal fertilizer supplies nutrients needed during early crop establishment, including those important for root development."),
        (1, "Top-dressing: If the fertilizer recommendation calls for nitrogen top-dressing, apply it while maize is actively growing and soil moisture is adequate. Place the fertilizer within reach of developing maize roots, while avoiding direct contact with the stem. The following are recommended top-dressing fertilizers: Kynoplus, Multi-feed, LAN and CAN"),
    ],
    "q-012": [(1, "Use well-decomposed farmyard manure or compost where available. Organic materials add nutrients and organic matter and can improve soil structure, water-holding capacity, and nutrient uptake. They should complement, rather than automatically replace, mineral fertilizer where additional nutrients are required. Apply well-decomposed manure at 4-6 tons per acre.")],
    "q-013": [
        (1, "Choose a maize cultivar adapted to your field's conditions. Consider rainfall, moisture availability, temperature, altitude, soil conditions, and the length of the growing season before selecting seed."),
        (1, "When rainfall is unreliable or you expect moisture stress, consider cultivars with documented drought adaptation and appropriate maturity duration."),
    ],
    "q-014": [
        (1, "Before purchasing seed, determine whether it is an OPV or a hybrid. If you are using a hybrid, do not assume that grain saved from the harvested crop will perform like the original certified hybrid seed. If using an OPV, follow appropriate seed-selection and storage practices if you intend to retain seed, and maintain varietal purity."),
        (1, "In the case of Lesotho, Okavango, ZM523, Nelson's Choice and ZM521 as OPV/synthetic OPV types, while Lake 401 and DKC73-72 are identified as hybrids."),
    ],
    "q-015": [(1, "Purchase seed of the selected cultivar from recognized seed companies. Check that the seed is correctly labeled (manufacturer, seed type, number of kernel/ package size, production date, estimated date of expiry), clean (free from impurities), uniform, germination percentage, moisture content, seed purity, pests and diseases, and free from visible damage, and certified.")],
    "q-016": [
        (2, "Farmers should plant maize when the rainy season has started and there is sufficient moisture in the soil to support germination and early crop establishment. Planting too early into inadequate moisture can result in poor or uneven germination, while waiting too long can shorten the effective growing period and expose the crop to greater production risks."),
        (2, "Do not rely on fixed calendar dates; instead, rely on climatic conditions and the time the crop needs to mature."),
    ],
    "q-017": [
        (2, "Maize may be planted manually using a hoe, with a jab planter, or using animal-drawn or tractor-mounted planting equipment where available. The choice should depend on farm size, terrain, labour availability, soil condition and access to equipment"),
        (2, "Consider planting basins (likoti) as part of the recommended local conservation-agriculture system; farmers should prepare and space them. Accordingly, pits about 15 x 30 cm in diameter and 15 – 20 cm deep are dug in a 75 x 75 cm grid."),
    ],
    "q-018": [
        (2, "Plant maize in straight, evenly spaced rows, maintaining the recommended distance of 70 cm × 30 cm between plants within each row for the following varieties: DKC 77-22, 73-72 and 76-71."),
        (2, "Spacing is often expressed as a range.  Consider an inter-row spacing of 90 cm–100 cm and an intra-row spacing of 25cm-30 cm, depending on the fertilizer rate applied. With this spacing, you can achieve a population of up to 45000 plants per hectare."),
    ],
    "q-019": [(2, "When intercropping maize with legumes, either beans or soybeans, use one maize row with three bean rows at 120 cm by 60 cm, or one maize row with two bean rows at 100 cm by 25 cm for maize and 50 cm by 10 cm for beans.")],
    "q-020": [
        (2, "Plant maize seed at a uniform depth so that plants emerge at approximately the same time and develop a more uniform crop stand"),
        (2, "Adjust planting depth according to soil moisture and local soil conditions. Plant at 2–3 cm in moist soil and about 5 cm for dry planting."),
    ],
    "q-021": [
        (2, "Use approximately 10kg of seed per acre and an optimum plant population of 21000 plants."),
        (2, "Plant approximately 21,000 plants per acre, depending on the maize variety and production environment. Achieve the target population by maintaining the recommended row and within-row spacing and the number of plants per planting point."),
    ],
    "q-022": [
        (1, "The right time: only provide nutrients when maize needs them. Fertilizer timing is particularly important for nitrogen. Apply fertilizer when the crop can take up and use the nutrients. Basal fertilizer is typically applied at planting or during early establishment, while the nitrogen required later in crop growth should be available during rapid maize growth."),
        (1, "Basal fertilizer: Apply an appropriate basal fertilizer at planting(6:2:1 (26), 6:2:1 (31), 2:3:4 (30), 20:7:3 (30), and 1:1:1 (39), or according to the recommended planting program, where the soil requires it."),
    ],
    "q-023": [
        (2, "Inspect the maize field shortly after emergence to determine whether plants have emerged uniformly and whether there are gaps, damaged seedlings, or areas with poor establishment. Early inspection lets you correct problems before the crop becomes too advanced."),
        (2, "Consider gap-filling or reseeding early enough to restore the intended plant population where significant gaps occur because seed has failed to germinate due to drought or seedlings have died shortly after emergence."),
    ],
    "q-024": [(3, "Control weeds early in the maize crop, approximately 2–3 weeks after planting and again around 5–6 weeks after planting, because young maize plants are particularly vulnerable to competition for water/moisture, nutrients, and sunlight and can also provide alternative hosts for pests and diseases.")],
    "q-025": [
        (3, "Farmers should not select a pesticide simply because it is available or because another farmer has used it. First, identify the problem in the maize field."),
        (3, "Use herbicides only when appropriate and according to the label. When using herbicides, select a product registered and recommended for maize, and use it at the correct rate, crop stage, and application conditions. Follow protective clothing and other safety precautions."),
    ],
    "q-026": [
        (1, "The right rate: Apply fertilizer according to soil conditions, crop requirements, and the recommended rate. Applying too little may not supply enough nutrients, while excessive fertilizer can waste money, increase nutrient losses, and potentially damage the crop."),
        (1, "Soil testing provides important information on soil pH, nitrogen, phosphorus, potassium, organic matter, and other relevant soil properties (chemical and physical properties). It can also help determine the fertilizer requirements for the intended yield."),
    ],
    "q-027": [
        (1, "The right place: ensure fertilizer is accessible to maize roots. So, place fertilizer close enough to the maize root zone for the crop to access it, but not so close that it contacts the seed or plant. Correct placement reduces nutrient loss and improves the crop's ability to use applied nutrients."),
        (1, "Do not allow concentrated fertilizer to remain in direct contact with the seed. When the planting method requires separate fertilizer placement, place fertilizer appropriately and cover it with a thin layer of soil before placing the seed."),
    ],
    "q-028": [
        (4, "Use integrated pest management rather than relying only on pesticides. This should include timely planting, field hygiene, crop rotation, resistant varieties, cultural practices, biological control, and chemical control where justified."),
        (4, "In the event that stalk-borer infestation requires chemical control, use only a pesticide currently registered and recommended for maize in Lesotho, follow the product label, and observe all safety and pre-harvest requirements."),
    ],
    "q-029": [(3, "Pre-emergence herbicides are applied before weeds become established, typically around planting or shortly thereafter, according to the specific product label. The MAFSN 2026/27 list of pre-emergence herbicides includes: CAMIX, PRIMAGRAM GOLD, MATAGAN GOLD, BULLET AND QUARDIAN")],
    "q-030": [(3, "For maize production, post-emergence herbicides can be broadly selected based on the types of weeds present. Some primarily control broadleaf weeds, others target grass weeds, while some products are active against both grass and broadleaf weeds. The MAFSN 2026/27 list of post-emergence herbicides includes: BASAGRAN, PANTERA and LAUDIS")],
    "q-031": [
        (6, "Check a mature maize kernel for the formation of a black layer at the point where the kernel attaches to the cob. The presence of a black layer indicates that the grain has reached physiological maturity."),
        (6, "Green maize is ready for harvest when the grain hardens or when the silky flowering at the top of the maize cob turns black."),
    ],
    "q-032": [(6, "Grain moisture is an important consideration when harvesting and handling maize. Maize harvested above the moisture level suitable for storage will require further drying before safe storage. Harvesting and drying can commence between 18% - 20% moisture or below, with 12.5% considered the optimum storage/acceptable selling moisture level in this production context.")],
    "q-033": [
        (6, "Harvesting should be undertaken in dry weather conditions. Wet harvesting conditions can increase the risk of rotting, contamination, and subsequent drying problems."),
        (6, "Move the maize carefully to a clean, suitable location for drying or further handling. Avoid throwing cobs onto bare soil or leaving them exposed to rain, animals, or unnecessary physical damage."),
    ],
    "q-034": [(6, "Mechanized harvesting, such as combine harvesting, can reduce harvesting time and handling operations. A combine can cut stalks, pick and de-husk cobs, shell, winnow, blow out chaff, clean grain and load it into bins or trailers in one run. It is faster than hand harvesting and reduces double handling, but it cannot pick up cobs lying on the ground, works inefficiently on lodged crops, and does not sort out cobs affected by rot.")],
    "q-035": [
        (6, "Once maize is harvested, handle it carefully to avoid unnecessary grain breakage, cracking, and contamination."),
        (6, "Move the maize carefully to a clean, suitable location for drying or further handling. Avoid throwing cobs onto bare soil or leaving them exposed to rain, animals, or unnecessary physical damage."),
    ],
    "q-036": [
        (6, "For sun drying, dry maize on a clean tarpaulin, drying sheet, concrete surface, or another suitable raised, clean drying surface rather than directly on bare soil to reduce risk of maize contamination from the soil."),
        (6, "When drying shelled maize, spread the grain to ensure even drying and turn it regularly. Uneven drying can leave some grain wetter than the rest, increasing the risk of deterioration during storage."),
        (6, "During drying, protect maize from rain, dew, animals, birds, and other contaminants. Cover the grain when weather conditions become unsuitable, or move it to a well-ventilated, protected drying area."),
    ],
    "q-037": [
        (6, "Using the correct moisture for the intended purpose is essential. Store maize at 12.5% moisture content"),
        (6, "A grain moisture meter is the most reliable way to test grain moisture."),
        (6, "Using a salt method, take a handful of maize grain, mix it with salt, pour it into a clean jar, and shake vigorously. If the salt sticks to the jar wall, it is an indication that the moisture is still high and needs to be reduced."),
        (6, "Biting maize is another way to check moisture. Bite the maize grain; if it is dry, it will become hard and crack, but if it is wet, your teeth will penetrate it."),
    ],
    "q-038": [
        (6, "Soon after shelling, remove foreign material such as cobs, husks, stones, soil, plant debris, and any other unwanted material. You can use winnowing, sieving, and mechanical cleaners to clean your maize; the best method depends on equipment availability and the quantity of maize."),
        (6, "Inspect your maize closely and separate unwanted grain, which might be rotten, insect-damaged, severely discolored, or broken, from sound, full grain."),
    ],
    "q-039": [
        (6, "Consider hermetic storage for grain protection, as it uses an airtight container or bag to restrict air and moisture exchange. When used correctly, it can substantially reduce insect damage and grain losses."),
        (6, "Use hermetic bags or metal silos when maize must be protected from storage insects for several months, preferably 6-8 months. For storage beyond 8 months, hermetic storage can continue to provide protection, but grain should still be monitored because storage performance depends on grain moisture, initial infestation, temperature, container integrity, and storage conditions."),
        (6, "Polypropylene bags are convenient and widely available, but they do not offer the same airtight protection as hermetic bags. Polypropylene bags are suitable mainly for short-term storage when maize is properly dried and protected from storage pests."),
    ],
    "q-040": [
        (6, "Consider hermetic storage for grain protection, as it uses an airtight container or bag to restrict air and moisture exchange. When used correctly, it can substantially reduce insect damage and grain losses."),
        (6, "Use hermetic bags or metal silos when maize must be protected from storage insects for several months, preferably 6-8 months."),
    ],
    "q-041": [
        (6, "Prevent conditions that favour mould by ensuring timely harvesting, proper drying, avoiding contact with soil, sorting damaged grain, keeping storage facilities dry and clean, and protecting stored maize from moisture."),
        (6, "Do not rely on visual inspection to detect aflatoxin, as you cannot reliably detect it by looking at maize. Remove visible mould and damaged grain, and ensure proper drying, sorting, and storage practices that reduce the risk of contamination. Laboratory or approved testing is required to determine whether contamination has occurred."),
    ],
    "q-042": [
        (6, "If using bags, raise or elevate them off the floor on a pallet or other suitable material to protect the maize from moisture and dirt, and to make it easier to inspect and clean."),
        (6, "A good maize storage facility must protect the grain from rain, ground moisture, rodents, and insect contamination. Ensure the roof does not leak and that ventilation is adequate."),
    ],
}

gold = json.load(open("/home/adem/Desktop/Coding/genie-ai-replica-itu/tests/rag-benchmarks/gold/gold_dataset.json"))
errors, total = [], 0
for e in gold["entries"]:
    chunks = []
    for fnum, prev in M[e["id"]]:
        total += 1
        if normalize(prev) not in TEXTS[fnum]:
            errors.append((e["id"], FILES[fnum], prev[:60]))
        chunks.append({"preview": prev, "source_doc": FILES[fnum]})
    e["expected_chunks"] = chunks

if errors:
    for eid, f, p in errors:
        print(f"SUBSTRING FAIL {eid} in {f}: {p}...")
    sys.exit(1)

gold["_doc"] = (
    "Gold v2 (2026-10-21): expected_chunks re-anchored to the distilled 7-file maize corpus "
    "(expert summary of the ~40 source docs). Same 42 questions/answers as v1 (Adem's xlsx); "
    "previews are verbatim passages from the ingested .md files (DEC-36 superseded by Adem 10-21). "
    "content_hash/chunk_key filled by match_gold_chunks.py."
)
gold["gold_version"] = 2
json.dump(gold, open(D + "gold_dataset.v2.json", "w"), indent=2, ensure_ascii=False)
print(f"OK: {len(gold['entries'])} entries, {total} previews, all verbatim-substring verified")
