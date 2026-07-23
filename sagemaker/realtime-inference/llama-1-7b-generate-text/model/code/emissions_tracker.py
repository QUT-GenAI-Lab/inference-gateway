from codecarbon import EmissionsTracker


def track_emissions(func):
    """
    Decorator to track emissions for a function using CodeCarbon's EmissionsTracker.
    This should be used to wrap the function that performs the inference, and it will add eco metrics to the result if requested.
    """

    def wrapper(*args, **kwargs):
        # 'data' is expected to be the first positional argument or a keyword argument
        data = args[0] if args else kwargs.get("data")
        if data is None:
            print("Warning: No 'data' argument found. Skipping emissions tracking.")
        if not isinstance(data, dict):
            print("Warning: 'data' is not a dictionary. Skipping emissions tracking.")
        include_eco_metrics = (
            data.get("include_eco_metrics", False) if isinstance(data, dict) else False
        )
        if not include_eco_metrics:
            return func(*args, **kwargs)

        # Disable writing to the output file by setting output_methods to an empty list
        # as we don't need to write a file in this context
        with EmissionsTracker(output_methods=[], log_level="warning") as tracker:
            result = func(*args, **kwargs)

        eco_metrics = {
            "co2_emissions_grams": tracker.final_emissions * 1000,
            "energy_consumed_kwh": tracker._total_energy.kWh,
            "water_consumed_liters": tracker._total_water.litres,
            "detailed_emissions": tracker.final_emissions_data.__dict__,
        }

        # If the result is a dictionary, add the eco_metrics to it
        if isinstance(result, dict):
            result["eco_metrics"] = eco_metrics
        return result

    return wrapper
