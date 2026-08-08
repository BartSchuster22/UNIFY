"""Governed UNIFY MemoryV4 tools for Hermes frameworks."""

from .tools import TOOLS, is_available


def register(ctx) -> None:
    """Register the governed tools when the Hermes plugin loader starts."""
    for name, schema, handler, emoji in TOOLS:
        ctx.register_tool(
            name=name,
            toolset="unify_memory",
            schema=schema,
            handler=handler,
            check_fn=is_available,
            emoji=emoji,
        )
