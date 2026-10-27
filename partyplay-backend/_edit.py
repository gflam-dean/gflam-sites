"""Helpers for editing these files. Import them instead of slicing by hand.

Written after a s[a:b] slice returned "" because the end marker sat BEFORE the
start marker, and replacing "" inserted a 60-line block between every character
of a 1400-line Worker. The file was unrecoverable from itself.
"""
import io

def cut(text, start_marker, end_marker):
    """The text between two markers, refusing to return an empty or reversed slice."""
    a = text.index(start_marker)
    b = text.index(end_marker)
    if b <= a:
        raise ValueError("end marker appears BEFORE start marker: %r before %r"
                         % (end_marker[:40], start_marker[:40]))
    return text[a:b]

def swap(text, old, new, expect=1):
    """Replace, refusing an empty needle or an unexpected number of hits."""
    if not old:
        raise ValueError("refusing to replace an empty string, which matches everywhere")
    n = text.count(old)
    if n != expect:
        raise ValueError("expected %d occurrence(s), found %d of %r" % (expect, n, old[:60]))
    return text.replace(old, new)
