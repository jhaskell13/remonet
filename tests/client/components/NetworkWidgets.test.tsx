import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DeviceTable, Stat, Topology } from '../../../src/components/NetworkWidgets.tsx';
import { areas, devices } from '../helpers/fixtures.ts';

describe('DeviceTable', () => {
  it('renders one row per device with its area name, status, and latency placeholder', () => {
    render(<DeviceTable rows={devices} areas={areas} />);
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(devices.length);
    const router = rows[0]!;
    expect(within(router).getByText('Core Router 01')).toBeTruthy();
    expect(within(router).getByText('RTR-001 · Router')).toBeTruthy();
    expect(within(router).getByText('North Campus')).toBeTruthy();
    expect(within(router).getByText('10.20.0.1')).toBeTruthy();
    expect(within(router).getByText('Healthy')).toBeTruthy();
    expect(within(router).getByText('Healthy').getAttribute('title')).toBe('answered in 4 ms at 10% load');
    expect(within(router).getByText('answered in 4 ms at 10% load')).toBeTruthy();
    expect(within(rows[1]!).getByText('latency 28 ms is above the 25 ms limit')).toBeTruthy();
    expect(within(router).getByText('4 ms')).toBeTruthy();
    // Offline and pending devices have no meaningful latency.
    expect(within(rows[2]!).getByText('—')).toBeTruthy();
    expect(within(rows[3]!).getByText('—')).toBeTruthy();
    expect(within(rows[3]!).getByText('Pending').className).toContain('pending');
  });

  it('falls back to the raw area id and shows an empty state', () => {
    render(<DeviceTable rows={[{ ...devices[0]!, areaId: 'area-unknown' }]} areas={areas} />);
    expect(screen.getByText('area-unknown')).toBeTruthy();
    render(<DeviceTable rows={[]} areas={areas} />);
    expect(screen.getByText(/no devices match your search/i)).toBeTruthy();
  });
});

describe('Stat and Topology', () => {
  it('renders a labelled metric', () => {
    render(<Stat label="Total devices" value="4" detail="Across 3 areas" icon="▤" accent="blue" />);
    expect(screen.getByText('Total devices')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText('Across 3 areas')).toBeTruthy();
  });

  it('labels the topology as illustrative', () => {
    const { container } = render(<Topology large />);
    expect(screen.getByText(/device connections are illustrative/i)).toBeTruthy();
    expect(container.querySelector('.topology-canvas.large')).toBeTruthy();
  });
});
