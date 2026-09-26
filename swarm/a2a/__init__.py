"""Swarm's agents as A2A (Agent2Agent protocol) services.

Each agent is its own A2A server with an agent card that says what it can do. Agents find each other
by skill and hand work over by sending A2A messages; nothing drives them from outside. The board stays
the shared record: every agent reads the task it was sent from the board and writes its result back,
so the dashboard, the MCP server and people see the same state.
"""

from .cards import AGENTS, agent_card, card_json
from .network import AgentNetwork

__all__ = ["AGENTS", "AgentNetwork", "agent_card", "card_json"]
