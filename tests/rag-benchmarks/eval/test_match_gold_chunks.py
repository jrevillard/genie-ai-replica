"""Unit tests for match_gold_chunks.py.

Covers the two el-salvador fixes:
  - default chunk-text field is `chunk_text`, not `text`
  - verbatim-substring fallback uses a sliding window for chunker-split previews
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from match_gold_chunks import find_matches, parse_args  # noqa: E402


def _chunk(key: str, text: str) -> dict:
    return {"key": key, "text": text}


class TestFindMatchesWholePreview:
    """The whole preview is a substring of one chunk: single match."""

    def test_exact_verbatim_match(self):
        chunks = [_chunk("a", "The quick brown fox jumps over the lazy dog.")]
        matches = find_matches("quick brown fox", chunks)
        assert [m["key"] for m in matches] == ["a"]

    def test_normalizes_case_and_whitespace(self):
        chunks = [_chunk("a", "The QUICK   brown fox")]
        matches = find_matches("quick brown FOX", chunks)
        assert [m["key"] for m in matches] == ["a"]


class TestFindMatchesWindowFallback:
    """Preview is split across chunks: BOTH halves match via window fallback."""

    def test_split_preview_across_two_chunks(self):
        # Preview is 100 chars; chunk A has first 60, chunk B has last 60.
        preview = (
            "Rubber strips can seal lids. Silicone fills grooves. "
            "Check for leaks with water and listen for hissing after three minutes."
        )
        chunks = [
            _chunk("a", preview[:60] + " extra padding that makes this chunk longer"),
            _chunk("b", "totally unrelated content " + preview[40:]),
        ]
        matches = find_matches(preview, chunks)
        keys = sorted(m["key"] for m in matches)
        assert keys == ["a", "b"]

    def test_short_preview_uses_strict_whole_match(self):
        # A short preview only matches if a chunk contains the whole preview.
        chunks = [
            _chunk("a", "Some unrelated content"),
            _chunk("b", "This chunk contains the slug exactly"),
        ]
        matches = find_matches("contains the slug exactly", chunks)
        assert [m["key"] for m in matches] == ["b"]

    def test_no_match_returns_empty(self):
        chunks = [_chunk("a", "Apple banana cherry")]
        assert find_matches("zebra yak", chunks) == []


class TestParseArgsChunkTextField:
    """The default --chunk-text-field is `chunk_text`, matching the el-salvador schema."""

    def test_default_is_chunk_text(self, monkeypatch):
        monkeypatch.setattr(sys, "argv", ["match_gold_chunks.py", "--gold-dataset", "x.json"])
        args = parse_args()
        assert args.chunk_text_field == "chunk_text"

    def test_override_takes_effect(self, monkeypatch):
        monkeypatch.setattr(
            sys,
            "argv",
            ["match_gold_chunks.py", "--gold-dataset", "x.json", "--chunk-text-field", "text"],
        )
        args = parse_args()
        assert args.chunk_text_field == "text"


class TestPassageRecall:
    """Passage-level recall: a passage counts only when ALL its chunks are retrieved."""

    def test_single_chunk_passage_retrieved(self):
        from run_eval import _passage_recall

        chunks = [{"chunk_key": "k1", "content_hash": "h1", "passage_id": "q1-p0"}]
        recall, n, retrieved = _passage_recall(chunks, ["h1"])
        assert (recall, n, retrieved) == (1.0, 1, 1)

    def test_single_chunk_passage_missing(self):
        from run_eval import _passage_recall

        chunks = [{"chunk_key": "k1", "content_hash": "h1", "passage_id": "q1-p0"}]
        recall, n, retrieved = _passage_recall(chunks, [])
        assert (recall, n, retrieved) == (0.0, 1, 0)

    def test_split_passage_fully_retrieved(self):
        from run_eval import _passage_recall

        chunks = [
            {"chunk_key": "k1", "content_hash": "h1", "passage_id": "q1-p0"},
            {"chunk_key": "k2", "content_hash": "h2", "passage_id": "q1-p0"},
        ]
        recall, n, retrieved = _passage_recall(chunks, ["h1", "h2"])
        assert (recall, n, retrieved) == (1.0, 1, 1)

    def test_split_passage_partially_retrieved(self):
        """Half of a split passage is NOT a passage-level hit — recall = 0 for that passage."""
        from run_eval import _passage_recall

        chunks = [
            {"chunk_key": "k1", "content_hash": "h1", "passage_id": "q1-p0"},
            {"chunk_key": "k2", "content_hash": "h2", "passage_id": "q1-p0"},
        ]
        recall, n, retrieved = _passage_recall(chunks, ["h1"])
        assert (recall, n, retrieved) == (0.0, 1, 0)

    def test_pre_refactor_gold_treats_each_chunk_as_own_passage(self):
        """Older gold sets lack passage_id — each chunk becomes its own singleton passage."""
        from run_eval import _passage_recall

        chunks = [
            {"chunk_key": "k1", "content_hash": "h1"},  # no passage_id
            {"chunk_key": "k2", "content_hash": "h2"},
        ]
        recall, n, retrieved = _passage_recall(chunks, ["h1", "h2"])
        # 2 singleton passages, both retrieved → recall 1.0
        assert (recall, n, retrieved) == (1.0, 2, 2)

    def test_mixed_passage_and_singleton(self):
        from run_eval import _passage_recall

        chunks = [
            {"chunk_key": "k1", "content_hash": "h1", "passage_id": "q1-p0"},
            {"chunk_key": "k2", "content_hash": "h2", "passage_id": "q1-p0"},
            {"chunk_key": "k3", "content_hash": "h3"},  # singleton
        ]
        # Passage q1-p0 needs h1+h2 (missing h2); singleton h3 needs h3 (present).
        # 1 of 2 passages retrieved → recall 0.5
        recall, n, retrieved = _passage_recall(chunks, ["h1", "h3"])
        assert (recall, n, retrieved) == (0.5, 2, 1)


class TestAtomicWrite:
    """All write modes are atomic: no .tmp file remains on success or failure."""

    PREVIEW = "The quick brown fox jumps over the lazy dog " * 4
    CHUNK = {"key": "ck1", "text": PREVIEW}
    GOLD = {"entries": [{"id": "q1", "expected_chunks": [{"preview": PREVIEW}]}]}

    def _run_main(self, tmp_path: Path, monkeypatch, mode: str, output: Path | None = None) -> int:
        import match_gold_chunks as mgc

        gold = tmp_path / "gold.json"
        gold.write_text(__import__("json").dumps(self.GOLD))
        # Stub the Arango round-trip with a single matching chunk.
        monkeypatch.setattr(mgc, "source_chunks", lambda *a, **k: [self.CHUNK])
        # Stub argparse-provided values that main() needs but parse_args
        # would otherwise try to read from disk.
        argv = [
            "match_gold_chunks.py",
            "--gold-dataset",
            str(gold),
            "--mode",
            mode,
        ]
        if output is not None:
            argv += ["--output", str(output)]
        monkeypatch.setattr(sys, "argv", argv)
        # Bypass the network — no real Arango needed for these write tests.
        return mgc.main()

    def test_in_place_writes_no_tmp(self, tmp_path, monkeypatch):
        rc = self._run_main(tmp_path, monkeypatch, mode="in-place")
        assert rc == 0
        gold = tmp_path / "gold.json"
        assert gold.is_file()
        # The temp file the writer uses is "<out_path>.tmp"; on success the
        # replace step has moved it, so the temp file must not exist.
        assert not (tmp_path / "gold.json.tmp").exists()
        # The new payload is well-formed and contains the expected match.
        payload = __import__("json").loads(gold.read_text())
        ec = payload["entries"][0]["expected_chunks"]
        assert ec[0]["match_status"] == "resolved"
        assert ec[0]["chunk_key"] == "ck1"

    def test_in_place_new_writes_no_tmp(self, tmp_path, monkeypatch):
        out = tmp_path / "fresh.json"
        rc = self._run_main(tmp_path, monkeypatch, mode="in-place-new", output=out)
        assert rc == 0
        assert out.is_file()
        assert not out.with_suffix(out.suffix + ".tmp").exists()

    def test_failure_during_write_cleans_up_tmp(self, tmp_path, monkeypatch):
        """When os.replace raises after the tmp file exists, the tmp is cleaned up."""
        import match_gold_chunks as mgc

        gold = tmp_path / "gold.json"
        gold.write_text(__import__("json").dumps(self.GOLD))
        monkeypatch.setattr(mgc, "source_chunks", lambda *a, **k: [self.CHUNK])
        monkeypatch.setattr(
            sys,
            "argv",
            ["match_gold_chunks.py", "--gold-dataset", str(gold), "--mode", "in-place"],
        )

        # Monkeypatch os.replace in the match_gold_chunks namespace to raise
        # AFTER the tmp file has been created and written — this exercises the
        # cleanup branch rather than preventing the tmp from ever existing.
        def fail_without_replace(src, dst):
            # Raise without calling os.replace — the tmp file stays on disk,
            # so atomic_write_json's cleanup branch can exercise the unlink path.
            raise RuntimeError("simulated disk full")

        monkeypatch.setattr(mgc.os, "replace", fail_without_replace)

        with pytest.raises(RuntimeError, match="simulated disk full"):
            mgc.main()
        # The tmp file must have been removed by the except handler.
        assert not (tmp_path / "gold.json.tmp").exists()
        # Original gold file is unchanged because os.replace never succeeded.
        original = __import__("json").loads(gold.read_text())
        assert original == self.GOLD


class TestInPlaceBackup:
    """In-place mode (and in-place-new writing over the input) keeps a one-generation .bak.json."""

    PREVIEW = "A preview string long enough to be matched verbatim in a chunk " * 3
    CHUNK = {"key": "ck1", "text": PREVIEW}
    GOLD = {"entries": [{"id": "q1", "expected_chunks": [{"preview": PREVIEW}]}]}

    def test_in_place_creates_backup_of_original(self, tmp_path, monkeypatch):
        import match_gold_chunks as mgc
        import json

        gold = tmp_path / "gold.json"
        original_bytes = json.dumps(self.GOLD, indent=2).encode()
        gold.write_bytes(original_bytes)
        monkeypatch.setattr(mgc, "source_chunks", lambda *a, **k: [self.CHUNK])
        monkeypatch.setattr(
            sys,
            "argv",
            ["match_gold_chunks.py", "--gold-dataset", str(gold), "--mode", "in-place"],
        )
        rc = mgc.main()
        assert rc == 0
        backup = tmp_path / "gold.json.bak.json"
        assert backup.is_file()
        # The backup holds the ORIGINAL bytes — pre-match content, not the
        # new payload.
        assert backup.read_bytes() == original_bytes
        # And the live gold now contains the match result.
        new_payload = json.loads(gold.read_text())
        assert new_payload["entries"][0]["expected_chunks"][0]["match_status"] == "resolved"

    def test_in_place_new_with_explicit_output_does_not_backup(self, tmp_path, monkeypatch):
        """When --output points somewhere else, no .bak.json is created for the input."""
        import match_gold_chunks as mgc
        import json

        gold = tmp_path / "gold.json"
        gold.write_text(json.dumps(self.GOLD))
        out = tmp_path / "fresh.json"
        monkeypatch.setattr(mgc, "source_chunks", lambda *a, **k: [self.CHUNK])
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "match_gold_chunks.py",
                "--gold-dataset",
                str(gold),
                "--output",
                str(out),
                "--mode",
                "in-place-new",
            ],
        )
        rc = mgc.main()
        assert rc == 0
        assert out.is_file()
        # Input gold was not overwritten, so no backup is required.
        assert not (tmp_path / "gold.json.bak.json").exists()


# --- F7 (MR !505 review): near-duplicate passages inflate gold ---------------

class TestPassageDedup:
    """F7: when two previews resolve to the same chunk-key set, the second
    is a near-duplicate of the first and would inflate passage-level recall
    (the eval would credit two gold passages for one retrieved set). The
    fix dedups across the WHOLE payload, keeping the first passage_id seen."""

    PREVIEW = "A preview string long enough to be matched verbatim in a chunk " * 3
    CHUNK = {"key": "ck1", "text": PREVIEW}
    GOLD = {
        "entries": [
            # q1 has the verbatim passage, previewed once
            {"id": "q1", "expected_chunks": [{"preview": PREVIEW}]},
            # q2 has the SAME verbatim passage in a second entry — should
            # be deduped to a single passage across the dataset.
            {"id": "q2", "expected_chunks": [{"preview": PREVIEW}]},
        ]
    }

    def test_duplicate_passage_dropped(self, tmp_path, monkeypatch, capsys):
        import match_gold_chunks as mgc
        import json

        gold = tmp_path / "gold.json"
        gold.write_text(json.dumps(self.GOLD))
        monkeypatch.setattr(mgc, "source_chunks", lambda *a, **k: [self.CHUNK])
        monkeypatch.setattr(
            sys,
            "argv",
            ["match_gold_chunks.py", "--gold-dataset", str(gold), "--mode", "in-place"],
        )
        rc = mgc.main()
        assert rc == 0
        payload = json.loads(gold.read_text())
        # The dedup operates at the payload level: same chunk-key set, second
        # occurrence dropped, first one kept.
        kept = []
        for entry in payload["entries"]:
            for ec in entry["expected_chunks"]:
                if ec.get("chunk_key"):
                    kept.append((entry["id"], ec.get("passage_id"), ec["chunk_key"]))
        # Exactly ONE resolved row remains — q1's passage (first seen).
        assert len(kept) == 1, f"expected 1 kept passage, got {kept}"
        assert kept[0][0] == "q1"
        # Stats record the dedup
        stats = payload["match_run"]["stats"]
        assert stats["deduped_passages"] == 1
        # And the stderr line surfaces the same number
        err = capsys.readouterr().err
        assert "deduped_passages=1" in err

    def test_distinct_passages_preserved(self, tmp_path, monkeypatch):
        """Sanity: distinct chunk-key sets (NOT duplicates) survive the dedup."""
        import match_gold_chunks as mgc
        import json

        # Two previews, each matching a different chunk → two passages
        preview_a = ("First preview " * 10)
        preview_b = ("Second preview " * 10)
        chunks = [
            {"key": "ck1", "text": preview_a + " tail to make it a full chunk"},
            {"key": "ck2", "text": preview_b + " tail to make it a full chunk"},
        ]
        gold = {
            "entries": [
                {"id": "q1", "expected_chunks": [{"preview": preview_a}]},
                {"id": "q2", "expected_chunks": [{"preview": preview_b}]},
            ]
        }
        gold_path = tmp_path / "gold.json"
        gold_path.write_text(json.dumps(gold))
        monkeypatch.setattr(mgc, "source_chunks", lambda *a, **k: chunks)
        monkeypatch.setattr(
            sys,
            "argv",
            ["match_gold_chunks.py", "--gold-dataset", str(gold_path),
             "--mode", "in-place"],
        )
        rc = mgc.main()
        assert rc == 0
        payload = json.loads(gold_path.read_text())
        kept = [
            ec
            for entry in payload["entries"]
            for ec in entry["expected_chunks"]
            if ec.get("chunk_key")
        ]
        assert len(kept) == 2  # both distinct passages survive
        assert payload["match_run"]["stats"]["deduped_passages"] == 0
