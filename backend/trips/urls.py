from django.urls import path

from trips import views

urlpatterns = [
    path("health/", views.health, name="health"),
    path("geocode/", views.geocode, name="geocode"),
    path("trips/", views.TripCreateView.as_view(), name="trip-create"),
    path("trips/<uuid:id>/", views.TripDetailView.as_view(), name="trip-detail"),
]
