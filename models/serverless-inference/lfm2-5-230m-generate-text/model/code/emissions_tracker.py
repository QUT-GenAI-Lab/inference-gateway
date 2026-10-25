from functools import wraps

from codecarbon import EmissionsTracker


def track_emissions(func):
    @wraps(func)
    def wrapper(data, *args, **kwargs):
        if not data.get("include_eco_metrics"):
            return func(data, *args, **kwargs)

        with EmissionsTracker(output_methods=[], log_level="warning") as tracker:
            result = func(data, *args, **kwargs)

        if isinstance(result, dict):
            result["eco_metrics"] = {
                "co2_emissions_grams": tracker.final_emissions * 1000,
                "energy_consumed_kwh": tracker._total_energy.kWh,
                "water_consumed_liters": tracker._total_water.litres,
                "detailed_emissions": tracker.final_emissions_data.__dict__,
            }
        return result

    return wrapper
