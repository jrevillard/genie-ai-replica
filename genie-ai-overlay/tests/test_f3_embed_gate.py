"""F3 pins: the TEI endpoint must win WITHOUT an HF token (the old gate silently
fell to local bge-base = 768-dim against a bge-m3 graph = the F10 dimension bomb).
Source-level pins: an OPEA_VERSION bump that reinstates the gate renames the
pinned shapes and these go red."""
import pytest


def test_retriever_tei_branch_has_no_token_gate():
    """The retriever source orders the TEI branch before any HF-token condition."""
    src = open("retriever/genieai_retriever_arangodb.py").read()
    i = src.find("elif TEI_EMBEDDING_ENDPOINT:")
    assert i != -1, "TEI branch missing"
    window = src[i:i + 700]
    assert "HF_TOKEN or" in window, "TEI branch must not require a real token (placeholder fallback)"
    assert "and HF_TOKEN:" not in window, "token gate reinstated - F10 dimension bomb is back"


def test_dataprep_override_wins_unconditionally():
    """Our subclass overrides _initialize_embeddings: endpoint set -> HuggingFaceHubEmbeddings."""
    src = open("dataprep/genieai_dataprep_arangodb.py").read()
    assert "def _initialize_embeddings(self):" in src
    assert "_parent_mod.TEI_EMBEDDING_ENDPOINT" in src
    assert '"internal-tei"' in src
