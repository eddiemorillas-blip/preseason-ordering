import { useState } from 'react';
import Layout from '../components/Layout';

const Help = () => {
  const [expandedSection, setExpandedSection] = useState('getting-started');

  const toggleSection = (section) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  const Section = ({ id, title, children }) => (
    <div className="border border-gray-200 rounded-lg overflow-hidden mb-4">
      <button
        onClick={() => toggleSection(id)}
        className="w-full px-6 py-4 bg-gray-50 hover:bg-gray-100 flex items-center justify-between text-left transition-colors"
      >
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        <svg
          className={`w-5 h-5 text-gray-500 transform transition-transform ${expandedSection === id ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expandedSection === id && (
        <div className="px-6 py-4 bg-white">
          {children}
        </div>
      )}
    </div>
  );

  const Step = ({ number, title, children }) => (
    <div className="flex gap-4 mb-4">
      <div className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-sm">
        {number}
      </div>
      <div>
        <h4 className="font-medium text-gray-900 mb-1">{title}</h4>
        <div className="text-gray-600 text-sm">{children}</div>
      </div>
    </div>
  );

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Help & Documentation</h1>
          <p className="mt-2 text-gray-600">
            Learn how to use the Preseason Ordering System to manage your seasonal orders efficiently.
          </p>
        </div>

        <Section id="getting-started" title="Getting Started">
          <div className="space-y-4">
            <p className="text-gray-600">
              The Preseason Ordering System helps you plan and manage seasonal product orders across multiple brands and locations.
              Here's how to get started:
            </p>
            <Step number="1" title="Upload Brand Catalogs">
              Before creating orders, upload product catalogs for each brand you work with.
              Go to <span className="font-medium">Catalog Upload</span> to import Excel or CSV files with product information.
            </Step>
            <Step number="2" title="Create a Season">
              Seasons help organize orders by time period (e.g., "Spring 2025", "Fall 2025").
              From the <span className="font-medium">Orders</span> page, click "New Season" to create one.
            </Step>
            <Step number="3" title="Create Orders">
              Within a season, create orders for each brand/location combination.
              Each order tracks products, quantities, and total costs.
            </Step>
            <Step number="4" title="Add Products to Orders">
              Open an order and click "Add Products" to browse the catalog and add items with quantities.
            </Step>
            <Step number="5" title="Export Orders">
              When ready, export orders in various formats (Standard, NuOrder, Elastic, or brand-specific templates).
            </Step>
          </div>
        </Section>

        <Section id="orders" title="Orders Page (Home)">
          <div className="space-y-4">
            <p className="text-gray-600">
              The Orders page is your main hub for managing all preseason orders.
            </p>

            <h3 className="font-semibold text-gray-900 mt-4">Seasons</h3>
            <ul className="list-disc list-inside text-gray-600 space-y-1 ml-2">
              <li><strong>Create Season:</strong> Click "New Season" to create a season with name, start/end dates, and budget</li>
              <li><strong>Set Budget:</strong> Click the budget icon to set or update the season's total budget</li>
              <li><strong>Delete Season:</strong> Remove seasons that are no longer needed (will delete all associated orders)</li>
            </ul>

            <h3 className="font-semibold text-gray-900 mt-4">Orders</h3>
            <ul className="list-disc list-inside text-gray-600 space-y-1 ml-2">
              <li><strong>Create Order:</strong> Click "New Order" to create an order for a specific brand and location</li>
              <li><strong>Order Status:</strong> Orders progress through Draft, Submitted, Approved, and Ordered statuses</li>
              <li><strong>View Order:</strong> Click an order row to open the Order Builder and manage products</li>
              <li><strong>Delete Order:</strong> Click the trash icon to remove an order</li>
            </ul>

            <h3 className="font-semibold text-gray-900 mt-4">Filters & Grouping</h3>
            <ul className="list-disc list-inside text-gray-600 space-y-1 ml-2">
              <li><strong>Filter by:</strong> Season, Brand, Location, or Status to find specific orders</li>
              <li><strong>Group by:</strong> Brand or Location to organize the order list</li>
              <li><strong>Collapse/Expand:</strong> Click brand headers to collapse or expand sections</li>
              <li><strong>Select All:</strong> Use the checkbox in each brand header to select all orders for that brand</li>
            </ul>

            <h3 className="font-semibold text-gray-900 mt-4">Exporting Orders</h3>
            <ul className="list-disc list-inside text-gray-600 space-y-1 ml-2">
              <li><strong>Select Orders:</strong> Check the boxes next to orders you want to export (must be same brand)</li>
              <li><strong>Export Formats:</strong> Standard Excel, NuOrder Excel, Elastic Suite Excel</li>
              <li><strong>Brand Templates:</strong> If configured, brand-specific templates will appear in the export menu</li>
            </ul>
          </div>
        </Section>

        <Section id="order-builder" title="Order Builder">
          <div className="space-y-4">
            <p className="text-gray-600">
              The Order Builder lets you manage products within a specific order.
            </p>

            <h3 className="font-semibold text-gray-900 mt-4">Adding Products</h3>
            <ul className="list-disc list-inside text-gray-600 space-y-1 ml-2">
              <li><strong>Add Products:</strong> Click the "Add Products" button to browse the catalog</li>
              <li><strong>Search & Filter:</strong> Use the search bar and filters to find products</li>
              <li><strong>Set Quantities:</strong> Enter quantities for each size/color variant</li>
              <li><strong>Ship Dates:</strong> Optionally specify ship dates for order items</li>
            </ul>

            <h3 className="font-semibold text-gray-900 mt-4">Managing Items</h3>
            <ul className="list-disc list-inside text-gray-600 space-y-1 ml-2">
              <li><strong>Edit Quantity:</strong> Click on a quantity to edit it directly</li>
              <li><strong>Delete Item:</strong> Click the X icon to remove an item (setting quantity to 0 also prompts deletion)</li>
              <li><strong>Delete Family:</strong> Remove all items in a product family at once</li>
              <li><strong>Collapse/Expand:</strong> Toggle product family sections to focus on what you need</li>
            </ul>

            <h3 className="font-semibold text-gray-900 mt-4">Order Summary</h3>
            <ul className="list-disc list-inside text-gray-600 space-y-1 ml-2">
              <li><strong>Total Units:</strong> Shows the total quantity of items in the order</li>
              <li><strong>Total Cost:</strong> Displays the wholesale cost total for the order</li>
              <li><strong>Status:</strong> Update the order status using the dropdown menu</li>
            </ul>

            <h3 className="font-semibold text-gray-900 mt-4">Exporting</h3>
            <ul className="list-disc list-inside text-gray-600 space-y-1 ml-2">
              <li><strong>Export Button:</strong> Download the order in various Excel formats</li>
              <li><strong>Copy Order:</strong> Duplicate the order to another location</li>
            </ul>
          </div>
        </Section>

        <Section id="products" title="Products Page">
          <div className="space-y-4">
            <p className="text-gray-600">
              View and search all products in your catalog across all brands.
            </p>

            <h3 className="font-semibold text-gray-900 mt-4">Features</h3>
            <ul className="list-disc list-inside text-gray-600 space-y-1 ml-2">
              <li><strong>Search:</strong> Find products by name, SKU, UPC, or other attributes</li>
              <li><strong>Filter by Brand:</strong> Show products from a specific brand</li>
              <li><strong>Filter by Category:</strong> Narrow down by product category</li>
              <li><strong>View Details:</strong> See product information including sizes, colors, and pricing</li>
            </ul>
          </div>
        </Section>

        <Section id="brands" title="Brands Page">
          <div className="space-y-4">
            <p className="text-gray-600">
              Manage your brand information and order form templates.
            </p>

            <h3 className="font-semibold text-gray-900 mt-4">Brand Management</h3>
            <ul className="list-disc list-inside text-gray-600 space-y-1 ml-2">
              <li><strong>Add Brand:</strong> Create new brands with contact information (Admin only)</li>
              <li><strong>Edit Brand:</strong> Update brand details and vendor codes</li>
              <li><strong>Vendor Code:</strong> Optional code used in exports for brand identification</li>
              <li><strong>Active Status:</strong> Deactivate brands to hide them from dropdowns</li>
            </ul>

            <h3 className="font-semibold text-gray-900 mt-4">Order Form Templates (Admin/Buyer)</h3>
            <ul className="list-disc list-inside text-gray-600 space-y-1 ml-2">
              <li><strong>Purpose:</strong> Upload brand-specific Excel order forms to use as export templates</li>
              <li><strong>Upload Template:</strong> Click a brand row to expand and manage its templates</li>
              <li><strong>Column Mapping:</strong> Map template columns to data fields (SKU, UPC, Quantity, etc.)</li>
              <li><strong>Data Start Row:</strong> Specify which row in the template the data should start</li>
              <li><strong>Export:</strong> When exporting orders, select the brand template to fill in the brand's specific form</li>
            </ul>
          </div>
        </Section>

        <Section id="catalog-upload" title="Catalog Upload (Admin/Buyer)">
          <div className="space-y-4">
            <p className="text-gray-600">
              Import product catalogs from Excel or CSV files to populate your product database.
            </p>

            <Step number="1" title="Select or Create Brand">
              Choose an existing brand or create a new one for this catalog.
            </Step>
            <Step number="2" title="Upload File">
              Drag and drop or select an Excel (.xlsx, .xls) or CSV file.
              For Excel files with multiple sheets, select which sheets to import.
            </Step>
            <Step number="3" title="Set Header Row">
              Specify which row contains your column headers (usually row 1).
            </Step>
            <Step number="4" title="Map Columns">
              Match your file's columns to the database fields:
              <ul className="list-disc list-inside ml-4 mt-2">
                <li><strong>Required:</strong> UPC, SKU, Product Name, Size, Color, Gender, Category</li>
                <li><strong>Optional:</strong> Wholesale Cost, MSRP, Subcategory, Inseam</li>
              </ul>
            </Step>
            <Step number="5" title="Preview & Upload">
              Review the preview and click "Upload Catalog" to import the products.
            </Step>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mt-4">
              <h4 className="font-medium text-yellow-800">Tips</h4>
              <ul className="list-disc list-inside text-yellow-700 text-sm mt-2 space-y-1">
                <li>The system auto-detects common column names and maps them automatically</li>
                <li>Existing products (matching UPC) will be updated with new information</li>
                <li>Upload history is tracked so you can see past imports</li>
              </ul>
            </div>
          </div>
        </Section>

        <Section id="sales-data" title="Sales Data Upload (Admin/Buyer)">
          <div className="space-y-4">
            <p className="text-gray-600">
              Import historical sales data to power order suggestions based on past performance.
            </p>

            <Step number="1" title="Upload Sales File">
              Select an Excel or CSV file containing your sales history.
            </Step>
            <Step number="2" title="Map Columns">
              Match columns to fields:
              <ul className="list-disc list-inside ml-4 mt-2">
                <li><strong>Quantity (Required):</strong> Number of units sold</li>
                <li><strong>UPC (Recommended):</strong> Product identifier to match catalog products</li>
                <li><strong>Product Name:</strong> Alternative product identifier</li>
                <li><strong>Location:</strong> Store/location where sale occurred</li>
                <li><strong>Date:</strong> When the sale occurred</li>
              </ul>
            </Step>
            <Step number="3" title="Set Date Range & Location">
              Specify the date range for this sales data and the location (if not in file).
            </Step>
            <Step number="4" title="Upload">
              Import the data. You can delete uploads later if needed.
            </Step>
          </div>
        </Section>

        <Section id="suggestions" title="Order Suggestions (Admin/Buyer)">
          <div className="space-y-4">
            <p className="text-gray-600">
              Get AI-powered order suggestions based on historical sales data.
            </p>

            <Step number="1" title="Select Filters">
              Choose a Brand and Location to analyze. Optionally adjust the sales history period.
            </Step>
            <Step number="2" title="Generate Suggestions">
              Click "Get Suggestions" to analyze sales data and generate recommended order quantities.
            </Step>
            <Step number="3" title="Review Suggestions">
              View suggested products grouped by family, with recommended quantities based on sales velocity.
            </Step>
            <Step number="4" title="Adjust Quantities">
              Modify suggested quantities as needed. Select items you want to include.
            </Step>
            <Step number="5" title="Create Order">
              Select a season and configure ship dates, then click "Add to Order" to create the order.
            </Step>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-4">
              <h4 className="font-medium text-blue-800">How Suggestions Work</h4>
              <p className="text-blue-700 text-sm mt-2">
                The system analyzes sales velocity (units sold per month) and projects future demand.
                Suggestions are based on products that match both your catalog (by UPC) and sales data.
              </p>
            </div>
          </div>
        </Section>

        <Section id="users" title="User Management (Admin Only)">
          <div className="space-y-4">
            <p className="text-gray-600">
              Manage user accounts and permissions for the system.
            </p>

            <h3 className="font-semibold text-gray-900 mt-4">User Roles</h3>
            <ul className="list-disc list-inside text-gray-600 space-y-1 ml-2">
              <li><strong>Viewer:</strong> Read-only access to orders, products, and brands</li>
              <li><strong>Buyer:</strong> Can create/edit orders, upload catalogs, and manage sales data</li>
              <li><strong>Admin:</strong> Full access including user management and brand configuration</li>
            </ul>

            <h3 className="font-semibold text-gray-900 mt-4">Managing Users</h3>
            <ul className="list-disc list-inside text-gray-600 space-y-1 ml-2">
              <li><strong>Add User:</strong> Click "Add New User" and fill in name, email, password, and role</li>
              <li><strong>View Users:</strong> See all users with their roles, status, and last login</li>
              <li><strong>Active Status:</strong> Users can be deactivated to prevent login</li>
            </ul>
          </div>
        </Section>

        <Section id="export-formats" title="Export Formats">
          <div className="space-y-4">
            <p className="text-gray-600">
              Export orders in various formats to submit to vendors or import into other systems.
            </p>

            <h3 className="font-semibold text-gray-900 mt-4">Standard Export</h3>
            <p className="text-gray-600 text-sm">
              Basic Excel format with all order details including SKU, UPC, product info, quantities, and pricing.
            </p>

            <h3 className="font-semibold text-gray-900 mt-4">NuOrder Export</h3>
            <p className="text-gray-600 text-sm">
              Formatted for import into the NuOrder B2B platform with appropriate column structure.
            </p>

            <h3 className="font-semibold text-gray-900 mt-4">Elastic Suite Export</h3>
            <p className="text-gray-600 text-sm">
              Formatted for import into Elastic Suite with their required column format.
            </p>

            <h3 className="font-semibold text-gray-900 mt-4">Brand Templates</h3>
            <p className="text-gray-600 text-sm">
              Custom templates uploaded per brand. The system fills in your data into the brand's specific order form format,
              preserving headers and formatting.
            </p>
          </div>
        </Section>

        <Section id="keyboard-shortcuts" title="Tips & Best Practices">
          <div className="space-y-4">
            <h3 className="font-semibold text-gray-900">General Tips</h3>
            <ul className="list-disc list-inside text-gray-600 space-y-1 ml-2">
              <li>Upload catalogs before creating orders to ensure products are available</li>
              <li>Use consistent naming for seasons (e.g., "Spring 2025", "Fall 2025")</li>
              <li>Set season budgets to track spending across all orders</li>
              <li>Use the suggestions feature if you have historical sales data</li>
            </ul>

            <h3 className="font-semibold text-gray-900 mt-4">Data Quality</h3>
            <ul className="list-disc list-inside text-gray-600 space-y-1 ml-2">
              <li>Ensure UPCs are consistent across catalogs and sales data for accurate matching</li>
              <li>Upload complete catalogs - missing products can't be added to orders</li>
              <li>Keep sales data current for better suggestions</li>
            </ul>

            <h3 className="font-semibold text-gray-900 mt-4">Workflow Recommendations</h3>
            <ul className="list-disc list-inside text-gray-600 space-y-1 ml-2">
              <li>Start with Draft status, move to Submitted when ready for review</li>
              <li>Use Approved status after internal approval, Ordered when sent to vendor</li>
              <li>Export orders after they reach Approved or Ordered status</li>
              <li>Create separate orders per brand/location for easier tracking</li>
            </ul>
          </div>
        </Section>

        <div className="mt-8 p-4 bg-gray-100 rounded-lg text-center">
          <p className="text-gray-600 text-sm">
            Need more help? Contact your system administrator.
          </p>
        </div>
      </div>
    </Layout>
  );
};

export default Help;
