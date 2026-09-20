from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("trips.urls")),
]

# JSON, not Django's HTML error pages -- this API is only ever consumed by fetch().
handler404 = "trips.errors.handler404"
handler500 = "trips.errors.handler500"
