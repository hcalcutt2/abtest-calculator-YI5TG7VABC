import React from "react";
import App from "./App.jsx";
import AdvancedHub from "./pages/AdvancedHub.jsx";
import SequentialTestingPage from "./pages/SequentialTesting.jsx";
import PoissonMeansPage from "./pages/PoissonMeans.jsx";
import SurvivalCurvesPage from "./pages/SurvivalCurves.jsx";
import FdrControlPage from "./pages/FdrControl.jsx";
import BayesianAbPage from "./pages/BayesianAb.jsx";
import ConceptsHub from "./pages/ConceptsHub.jsx";
import TypeErrorsPlayground from "./pages/TypeErrorsPlayground.jsx";
import PHackingPlayground from "./pages/PHackingPlayground.jsx";
import SimpsonsParadox from "./pages/SimpsonsParadox.jsx";
import LawOfLargeNumbers from "./pages/LawOfLargeNumbers.jsx";
import DistributionsPlayground from "./pages/DistributionsPlayground.jsx";
import StatPowerPlayground from "./pages/StatPowerPlayground.jsx";
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
  if (route === "/concepts") {
    return <ConceptsHub theme={theme} toggleTheme={toggleTheme} />;
  }
  if (route === "/concepts/type-errors") {
    return <TypeErrorsPlayground theme={theme} toggleTheme={toggleTheme} />;
  }
  if (route === "/concepts/power") {
    return <StatPowerPlayground theme={theme} toggleTheme={toggleTheme} />;
  }
  if (route === "/concepts/p-hacking") {
    return <PHackingPlayground theme={theme} toggleTheme={toggleTheme} />;
  }
  if (route === "/concepts/simpsons") {
    return <SimpsonsParadox theme={theme} toggleTheme={toggleTheme} />;
  }
  if (route === "/concepts/law-large-numbers") {
    return <LawOfLargeNumbers theme={theme} toggleTheme={toggleTheme} />;
  }
  if (route === "/concepts/distributions") {
    return <DistributionsPlayground theme={theme} toggleTheme={toggleTheme} />;
  }

  return (
    <AdvancedHub theme={theme} toggleTheme={toggleTheme} />
  );
}
