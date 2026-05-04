How to use it:

import AskBar from "./AskBar";

function MyDashboard() {
  const [filters, setFilters] = useState({...});
  const activeFilterCount = Object.values(filters).flat().length;

  return (
    <AskBar
      onApply={(parsedFilters) => setFilters(parsedFilters)}
      currentFilterCount={activeFilterCount}
    />
  );
}
