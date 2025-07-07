#!/bin/bash

# Build the project
npm run build

# Deploy to Railway (example)
railway up

# Or deploy to Render (example)
# render deploy

echo "Deployment complete!"
echo "Don't forget to:"
echo "1. Set up Stripe webhook endpoint: https://your-domain.com/api/subscription/webhook"
echo "2. Configure environment variables in your hosting platform"
echo "3. Run the database migrations"
