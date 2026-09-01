"""Aggregates the v1 routers."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import admin, auth, complaints, notifications, public, team
from app.api.v1 import map as map_routes

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(public.router)
api_router.include_router(complaints.router)
api_router.include_router(map_routes.router)
api_router.include_router(team.router)
api_router.include_router(notifications.router)
api_router.include_router(admin.router)
