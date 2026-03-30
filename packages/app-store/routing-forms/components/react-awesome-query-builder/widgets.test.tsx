import { render, screen } from "@testing-library/react";
import { vi } from "vitest";

import widgets from "./widgets";

const { SelectWidget, MultiSelectWidget, CheckboxGroupWidget, TextWidget } = widgets;

// Mock the dynamic import of Select component
vi.mock("next/dynamic", () => ({
  __esModule: true,
  default: () => {
    return function MockSelect({
      options,
      onChange,
      value,
      isMulti,
    }: {
      options: { value: string; label: string }[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onChange: (value: any) => void;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      value: any;
      isMulti: boolean;
    }) {
      return (
        <select
          data-testid="mock-select"
          multiple={isMulti}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          value={isMulti ? value.map((v: any) => v.value) : value?.value}
          onChange={(e) => {
            const selectedOptions = Array.from(e.target.selectedOptions, (option) => ({
              value: option.value,
              label: option.text,
            }));
            onChange(isMulti ? selectedOptions : selectedOptions[0]);
          }}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    };
  },
}));

describe("Select Widgets", () => {
  describe("SelectWidget", () => {
    const listValues = [
      { title: "Option 1", value: "1" },
      { title: "Option 2", value: "2" },
      { title: "Option 3", value: "3" },
    ];

    it("should handle render the value in option correctly", () => {
      const setValue = vi.fn();
      render(<SelectWidget value="2" setValue={setValue} listValues={listValues} />);

      const select = screen.getByTestId("mock-select");
      expect(select).toBeInTheDocument();
      expect(screen.getAllByRole("option")).toHaveLength(3);
      expect(setValue).not.toHaveBeenCalled();
    });

    it("should handle a value that is not in the list and reset the value to empty string", () => {
      const setValue = vi.fn();
      render(<SelectWidget value="4" setValue={setValue} listValues={listValues} />);

      const select = screen.getByTestId("mock-select");
      expect(select).toBeInTheDocument();
      expect(screen.getAllByRole("option")).toHaveLength(3);
      expect(setValue).toHaveBeenCalledWith("");
    });
  });

  describe("MultiSelectWidget", () => {
    const listValues = [
      { title: "Option 1", value: "1" },
      { title: "Option 2", value: "2" },
      { title: "Option 3", value: "3" },
    ];

    it("renders options correctly", () => {
      const setValue = vi.fn();

      render(<MultiSelectWidget value={[]} setValue={setValue} listValues={listValues} />);

      const select = screen.getByTestId("mock-select");
      expect(select).toBeInTheDocument();
      expect(screen.getAllByRole("option")).toHaveLength(3);
      expect(setValue).not.toHaveBeenCalled();
    });

    it("sets value to empty array when no options match", () => {
      const setValue = vi.fn();
      render(<MultiSelectWidget value={["4", "5"]} setValue={setValue} listValues={listValues} />);

      expect(setValue).toHaveBeenCalledWith([]);
    });
  });

  describe("CheckboxGroupWidget", () => {
    const listValues = [
      { title: "Option 1", value: "1" },
      { title: "Option 2", value: "2" },
      { title: "Option 3", value: "3" },
    ];

    it("should render the correct number of checkbox options", () => {
      const setValue = vi.fn();
      render(<CheckboxGroupWidget value={[]} setValue={setValue} listValues={listValues} />);

      // CheckboxGroupWidget renders one native checkbox input per listValue option
      expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    });

    it("should maintain matching values correctly", () => {
      const setValue = vi.fn();
      render(<CheckboxGroupWidget value={["1", "3"]} setValue={setValue} listValues={listValues} />);

      // When all selected values exist in listValues, setValue should NOT be called
      expect(setValue).not.toHaveBeenCalled();
    });

    it("should clear stale selections when list values are absent", () => {
      const setValue = vi.fn();
      render(<CheckboxGroupWidget value={["4", "5"]} setValue={setValue} listValues={listValues} />);

      // When values don't match any listValues, widget should clear by calling setValue([])
      // This follows the same pattern as MultiSelectWidget stale value clearing
      expect(setValue).toHaveBeenCalledWith([]);
    });

    it("should handle empty listValues gracefully", () => {
      const setValue = vi.fn();
      // @ts-expect-error - testing undefined listValues guard
      const { container } = render(<CheckboxGroupWidget value={[]} setValue={setValue} listValues={undefined} />);

      // Widget should return null when listValues is undefined (same as MultiSelectWidget pattern)
      expect(container.firstChild).toBeNull();
    });
  });
});

describe("Gap 2 — Date field TextWidget type", () => {
  it('should render an input with type="date" when type prop is "date"', () => {
    const setValue = vi.fn();
    const { container } = render(<TextWidget value="" setValue={setValue} type="date" />);

    // jsdom does not expose type="date" inputs via the "textbox" role,
    // so we query by selector directly to verify the type attribute.
    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement | null;
    expect(dateInput).toBeTruthy();
    expect(dateInput!.type).toBe("date");
  });

  it('should default to type="text" when no type prop is provided', () => {
    const setValue = vi.fn();
    render(<TextWidget value="" setValue={setValue} />);

    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.type).toBe("text");
  });
});
