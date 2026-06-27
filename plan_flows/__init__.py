"""Production plan-orchestration seam shared by the runtime bridge and tests.

These modules own the path from a seeded redemption plan to graph-write rows
(``redemption_graph_writer``) and the create/replan orchestration over the
``V31GraphWriteService`` (``hero_flow``). They live outside ``tests/`` so the
runtime ``apps/api/bridge/hero_bridge.py`` never imports from the test tree.
"""
