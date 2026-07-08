/**
 * ui/DataTable — table adapter built on @mui/x-data-grid (Community edition, no
 * Pro/licensed features). The props are kept library-agnostic where practical.
 */
import { DataGrid } from '@mui/x-data-grid';
import type { DataGridProps, GridColDef, GridRowParams, GridValidRowModel } from '@mui/x-data-grid';

export type { GridColDef };

// Rows need either an `id` field OR the `getRowId` prop (the DataGrid contract).
export interface DataTableProps<Row extends GridValidRowModel>
  extends Omit<DataGridProps<Row>, 'rows' | 'columns'> {
  rows: Row[];
  columns: GridColDef[];
  onRowClick?: (params: GridRowParams) => void;
}

export function DataTable<Row extends GridValidRowModel>({
  rows,
  columns,
  onRowClick,
  ...rest
}: DataTableProps<Row>) {
  return (
    <DataGrid
      rows={rows}
      columns={columns}
      onRowClick={onRowClick}
      disableColumnMenu
      disableRowSelectionOnClick
      autoHeight
      // Under jsdom (Vitest) the container has no size -> without this no rows
      // would render. In production virtualization stays enabled.
      disableVirtualization={import.meta.env.MODE === 'test'}
      pageSizeOptions={[25, 50, 100]}
      initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
      sx={{
        border: 'none',
        '& .MuiDataGrid-row': onRowClick ? { cursor: 'pointer' } : undefined,
        '& .MuiDataGrid-columnHeaders': { backgroundColor: 'background.default' },
      }}
      {...rest}
    />
  );
}
