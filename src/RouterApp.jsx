import React from "react";
import App from "./App.jsx";
import AdvancedHub from "./pages/AdvancedHub.jsx";
import SequentialTestingPage from "./pages/SequentialTesting.jsx";
import PoissonMeansPage from "./pages/PoissonMeans.jsx";
import SurvivalCurvesPage from "./pages/SurvivalCurves.jsx";
import FdrControlPage from "./pages/FdrControl.jsx";
import BayesianAbPage from "./pages/BayesianAb.jsx";
import { useHashRoute, useTheme, useStableNumericInputs } from "./shared/gds.jsx";

export default function RouterApp() {
  const route = useHashRoute();
  const { theme, toggle: toggleTheme } = useTheme();
  useStableNumericInputs();

  if (route === "/" || route === "") {
    return <App theme={theme} toggleTheme={toggleTheme} />;
  }
  if (route === "/advanced") {
    return <AdvancedHub theme={theme} toggleTheme={toggleTheme} />;
  }
  if (route === "/advanced/sequential") {
    return <SequentialTestingPage theme={theme} toggleTheme={toggleTheme} />;
  }
  if (route === "/advanced/poisson") {
    return <PoissonMeansPage theme={theme} toggleTheme={toggleTheme} />;
  }
  if (route === "/advanced/survival") {
    return <SurvivalCurvesPage theme={theme} toggleTheme={toggleTheme} />;
  }
  if (route === "/advanced/fdr") {
    return <FdrControlPage theme={theme} toggleTheme={toggleTheme} />;
  }
  if (route === "/advanced/bayesian") {
    return <BayesianAbPage theme={theme} toggleTheme={toggleTheme} />;
  }

  return (
    <AdvancedHub theme={theme} toggleTheme={toggleTheme} />
  );
}
