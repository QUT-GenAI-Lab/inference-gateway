export class PreprocessorBuilder {
  _preprocessors: ((value: unknown) => unknown)[] = [];

  /**
   * SageMaker endpoints return the response as a JSON string in a tuple with the content type, e.g. ["{\"key\": \"value\"}", "application/json"]. This preprocessor parses the JSON string into an object.
   */
  parseJsonTuple() {
    this._preprocessors.push((value: unknown) => {
      if (
        Array.isArray(value) &&
        value.length === 2 &&
        typeof value[0] === "string" &&
        value[1] === "application/json"
      ) {
        try {
          return JSON.parse(value[0]);
        } catch {
          return value;
        }
      }

      return value;
    });
    return this;
  }

  /**
   * Normalises the eco_metrics response by renaming the 'eco_metrics' key to 'ecoMetrics'.
   */
  normaliseEcoMetricsResponse() {
    this._preprocessors.push((value: unknown) => {
      if (
        typeof value !== "object" ||
        value === null ||
        !("eco_metrics" in value)
      ) {
        return value;
      }
      const { eco_metrics: ecoMetrics, ...response } = value;
      return { ...response, ecoMetrics };
    });
    return this;
  }

  build(): (value: unknown) => unknown {
    return (value: unknown) => {
      return this._preprocessors.reduce(
        (acc, processor) => processor(acc),
        value,
      );
    };
  }
}
