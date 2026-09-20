from django.contrib import admin

from trips.models import DutyEntry, GeocodeCache, LogDay, RouteLeg, Stop, Trip


class StopInline(admin.TabularInline):
    model = Stop
    extra = 0


class LogDayInline(admin.TabularInline):
    model = LogDay
    extra = 0


@admin.register(Trip)
class TripAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "current_location",
        "pickup_location",
        "dropoff_location",
        "total_distance_miles",
        "created_at",
    )
    inlines = (StopInline, LogDayInline)
    readonly_fields = ("id", "created_at")


admin.site.register([RouteLeg, DutyEntry, GeocodeCache])
