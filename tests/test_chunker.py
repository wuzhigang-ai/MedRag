"""Test medical_chunker integration with pipeline"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))


def test_chunker_integration():
    """Test that chunks loaded by pipeline have section_tag metadata"""
    from src.pipeline import MedicalRAGPipeline
    p = MedicalRAGPipeline(content_dir="./output/remote_test")
    p.load_documents()

    # At least some chunks should have section_tag metadata
    tagged = [m for m in p.chunk_meta if "section_tag" in m]
    assert len(tagged) > 0, "No chunks have section_tag — chunker not integrated"

    # Verify known section tags appear
    tags_found = set(m.get("section_tag", "") for m in p.chunk_meta if m.get("section_tag"))
    expected = {"background", "methods", "results", "conclusion", "objective",
                "intervention", "primary_outcome", "safety", "discussion"}
    found = tags_found & expected
    assert len(found) >= 2, f"Expected at least 2 known section tags, got: {found}"

    print(f"Chunker integration: {len(tagged)}/{len(p.chunk_meta)} chunks tagged")
    print(f"  Tags found: {sorted(tags_found)}")


def test_section_tag_relevant():
    """Test that section tags match actual content"""
    from src.pipeline import MedicalRAGPipeline
    p = MedicalRAGPipeline(content_dir="./output/remote_test")
    p.load_documents()

    # Check a tagged chunk's content matches its tag
    for i, meta in enumerate(p.chunk_meta):
        if meta.get("section_tag") == "conclusion":
            text = p.all_chunks[i].lower()
            # Conclusion chunks should contain conclusion-related words
            assert any(w in text for w in ["结论", "总结", "conclusion", "推荐", "建议"]), \
                f"Chunk tagged 'conclusion' doesn't contain conclusion keywords: {text[:100]}..."
            break
    else:
        # No conclusion chunks found — that's fine for small doc sets
        pass

    print("Section tag relevance check passed")


if __name__ == "__main__":
    test_chunker_integration()
    test_section_tag_relevant()
    print("\nAll chunker integration tests passed!")
