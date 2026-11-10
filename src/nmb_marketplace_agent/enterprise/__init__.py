"""Enterprise layer: governance, workflows, solution packs, licensing.

Everything here is additive: the core agent platform keeps working without it,
and each capability is gated by a license entitlement (see ``licensing``).
"""


"""Enterprise layer: governance, workflows, solution packs, licensing."""
from dotenv import load_dotenv  # installed with pydantic-settings

# The app reads .env through its settings class, which does not populate os.environ.
# The enterprise modules read os.environ directly, so load it here (real env vars still win).
load_dotenv(override=False)