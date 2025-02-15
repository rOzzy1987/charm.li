#!/bin/sh

echo "Installing NPM packages"
npm i > start.log

echo "Building node-LMDB"
cd node_modules/node-lmdb
node-gyp configure >> start.log
node-gyp build >> start.log
cd ../..

echo "Mounting lmdb-pages" 
# Check if lmdb-pages.sqsh is already mounted as SquashFS
if mount | grep "lmdb-pages.sqsh" | grep -q "squashfs"; then
  echo "lmdb-pages.sqsh is already mounted as a SquashFS filesystem." >> start.log
else
  echo "lmdb-pages.sqsh is not mounted. Mounting as read-only SquashFS..." >> start.log

  # Create a mount point if it doesn't exist
  MOUNT_POINT="./lmdb-pages"
  if [ ! -d "$MOUNT_POINT" ]; then
    echo "Creating mount directory $MOUNT_POINT" >> start.log
    mkdir -p "$MOUNT_POINT"
  fi

  # Mount the lmdb-pages.sqsh file as a SquashFS filesystem read-only
  echo "Mounting image" >> start.log
  sudo mount -t squashfs -o loop lmdb-pages.sqsh "$MOUNT_POINT"
fi


# Check if the mount was successful
if mount | grep "lmdb-pages.sqsh" | grep -q "squashfs"; then
  echo "Successfully mounted lmdb-pages.sqsh as a SquashFS filesystem." >> start.log
  echo "Starting server"
  npm start -- / 8080
else
  echo "Failed to mount lmdb-pages.sqsh." >> start.log
  echo "Failed to mount lmdb-pages.sqsh."
fi