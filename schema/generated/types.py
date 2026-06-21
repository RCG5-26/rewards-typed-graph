"""Generated from schema/contracts/graph.schema.json. Do not edit by hand."""

from __future__ import annotations

from typing import Mapping, Optional, Tuple

NODE_TYPES: Tuple[str, ...] = ('User', 'Card', 'Program', 'MerchantCategory', 'Balance', 'Goal', 'PlanQuery', 'PlanStep')
EDGE_TYPES: Tuple[str, ...] = ('HOLDS', 'ASSOCIATED_WITH', 'EARNS', 'HAS_BALANCE', 'BALANCE_FOR', 'HAS_GOAL', 'FOR_USER', 'TRANSFERS_TO', 'TARGETS', 'STEP_OF', 'DEPENDS_ON')
GRAPH_TIERS: Tuple[str, ...] = ('world', 'personal', 'plan')
PROGRAM_KINDS: Tuple[str, ...] = ('transferable', 'airline', 'hotel', 'cashback')
PLAN_STATUSES: Tuple[str, ...] = ('active', 'stale', 'superseded', 'completed', 'failed')
PLAN_QUERY_STATUSES: Tuple[str, ...] = ('active', 'completed', 'failed')
MUTATION_ACTIONS: Tuple[str, ...] = ('create_node', 'update_node', 'create_edge', 'update_edge', 'mark_stale', 'supersede_plan_step', 'transfer_points')
EARN_TYPES: Tuple[str, ...] = ('points', 'miles', 'cashback_pct')

NODE_REQUIRED_ATTRIBUTES: Mapping[str, Tuple[str, ...]] = {'User': ('name', 'optimization_goal'), 'Card': ('name', 'issuer', 'network', 'annual_fee_cents'), 'Program': ('name', 'kind', 'currency_name'), 'MerchantCategory': ('name',), 'Balance': ('program_id', 'amount_points', 'as_of', 'source'), 'Goal': ('goal_type', 'description'), 'PlanQuery': ('plan_lineage_id', 'revision_number', 'query_text', 'status'), 'PlanStep': ('plan_lineage_id', 'revision_number', 'step_order', 'agent', 'claim', 'inputs', 'output', 'status')}
NODE_ATTRIBUTE_TYPES: Mapping[str, Mapping[str, str]] = {'User': {'name': 'str', 'optimization_goal': 'str'}, 'Card': {'name': 'str', 'issuer': 'str', 'network': 'str', 'annual_fee_cents': 'int', 'signup_bonus_points': 'int', 'signup_bonus_spend_cents': 'int'}, 'Program': {'name': 'str', 'kind': 'str', 'currency_name': 'str'}, 'MerchantCategory': {'name': 'str', 'mcc_codes': 'list[int]'}, 'Balance': {'program_id': 'str', 'amount_points': 'int', 'as_of': 'str', 'source': 'str'}, 'Goal': {'goal_type': 'str', 'description': 'str', 'target_program_id': 'str', 'target_location': 'str', 'target_date': 'str'}, 'PlanQuery': {'plan_lineage_id': 'str', 'revision_number': 'int', 'query_text': 'str', 'status': 'str', 'summary': 'str|null'}, 'PlanStep': {'plan_lineage_id': 'str', 'revision_number': 'int', 'step_order': 'int', 'agent': 'str', 'claim': 'str', 'inputs': 'object', 'output': 'object', 'status': 'str', 'stale_reason': 'str|null', 'supersedes_plan_step_id': 'str|null', 'superseded_by_plan_step_id': 'str|null'}}
NODE_TIERS: Mapping[str, str] = {'User': 'personal', 'Card': 'world', 'Program': 'world', 'MerchantCategory': 'world', 'Balance': 'personal', 'Goal': 'personal', 'PlanQuery': 'plan', 'PlanStep': 'plan'}
EDGE_TYPE_RULES: Mapping[str, Tuple[str, Optional[str]]] = {'HOLDS': ('User', 'Card'), 'ASSOCIATED_WITH': ('Card', 'Program'), 'EARNS': ('Card', 'MerchantCategory'), 'HAS_BALANCE': ('User', 'Balance'), 'BALANCE_FOR': ('Balance', 'Program'), 'HAS_GOAL': ('User', 'Goal'), 'FOR_USER': ('PlanQuery', 'User'), 'TRANSFERS_TO': ('Program', 'Program'), 'TARGETS': ('PlanQuery', 'Goal'), 'STEP_OF': ('PlanStep', 'PlanQuery'), 'DEPENDS_ON': ('PlanStep', None)}
EDGE_REQUIRED_ATTRIBUTES: Mapping[str, Tuple[str, ...]] = {'HOLDS': (), 'ASSOCIATED_WITH': (), 'EARNS': ('earn_rate_basis_points', 'earn_type'), 'HAS_BALANCE': (), 'BALANCE_FOR': (), 'HAS_GOAL': (), 'FOR_USER': (), 'TRANSFERS_TO': ('ratio_num', 'ratio_den', 'transfer_time_days', 'is_active'), 'TARGETS': (), 'STEP_OF': (), 'DEPENDS_ON': ('observed_version', 'observed_value')}
EDGE_ATTRIBUTE_TYPES: Mapping[str, Mapping[str, str]] = {'HOLDS': {'opened_date': 'str', 'is_primary': 'bool'}, 'ASSOCIATED_WITH': {}, 'EARNS': {'earn_rate_basis_points': 'int', 'earn_type': 'str', 'cap_amount_cents': 'int|null'}, 'HAS_BALANCE': {}, 'BALANCE_FOR': {}, 'HAS_GOAL': {}, 'FOR_USER': {}, 'TRANSFERS_TO': {'ratio_num': 'int', 'ratio_den': 'int', 'transfer_time_days': 'int', 'is_active': 'bool'}, 'TARGETS': {}, 'STEP_OF': {}, 'DEPENDS_ON': {'observed_version': 'int', 'observed_property': 'str|null', 'observed_value': 'any'}}
