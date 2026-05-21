
This will be a big refractor but its a simple one.
We need to make the boundary between live and test data explicit. In the accounts page, add a toggle to the right of the header. This will be the toggle for live vs mock/paper.
We need to update all subsequent logic to stop showing both options for paper vs live, and only show one or the other based on the toggle.
This is to separate lower and production environments. This is a huge endeavor so we are going to need a very precise plan on every point that we need to address.
