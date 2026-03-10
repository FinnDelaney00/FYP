export function buildSmoothLinePath(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return "";
  }

  if (points.length === 1) {
    return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  }

  const tension = 0.2;
  let path = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;

  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;

    const c1x = p1.x + ((p2.x - p0.x) * tension) / 6;
    const c1y = p1.y + ((p2.y - p0.y) * tension) / 6;
    const c2x = p2.x - ((p3.x - p1.x) * tension) / 6;
    const c2y = p2.y - ((p3.y - p1.y) * tension) / 6;

    path += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }

  return path;
}

export function buildAreaPath(points, baselineY, linePath) {
  if (!Array.isArray(points) || points.length === 0) {
    return "";
  }

  const first = points[0];
  const last = points[points.length - 1];
  return `${linePath} L ${last.x.toFixed(1)} ${baselineY.toFixed(1)} L ${first.x.toFixed(1)} ${baselineY.toFixed(1)} Z`;
}

export function buildLinearPath(points, closePath = false) {
  const coords = Array.isArray(points) ? points : [];
  if (!coords.length) {
    return "";
  }

  let path = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
  for (let index = 1; index < coords.length; index += 1) {
    path += ` L ${coords[index].x.toFixed(1)} ${coords[index].y.toFixed(1)}`;
  }

  return closePath ? `${path} Z` : path;
}

export function pickSeriesAxisLabels(series, slots = 6, labelKeys = ["label"]) {
  const points = Array.isArray(series) ? series : [];
  if (!points.length) {
    return Array.from({ length: slots }, () => "--");
  }

  const readLabel = (item) => {
    for (const key of labelKeys) {
      const value = item?.[key];
      if (value) {
        return value;
      }
    }
    return "--";
  };

  if (points.length === 1) {
    return Array.from({ length: slots }, () => readLabel(points[0]));
  }

  return Array.from({ length: slots }, (_, index) => {
    const ratio = index / (slots - 1);
    const pointIndex = Math.round(ratio * (points.length - 1));
    return readLabel(points[pointIndex]);
  });
}
